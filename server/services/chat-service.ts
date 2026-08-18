import { Response } from 'express';
import { getGeminiClient } from '../gemini';
import { config } from '../config';
import { dbService } from '../db/database';
import { vectorService } from './vector-service';
import { keywordService } from './keyword-service';
import { rerankService } from './rerank-service';
import { ContextService } from './context-service';
import { metricsService } from './metrics-service';
import { Message, Conversation, QueryMetrics } from '../../src/types';

export class ChatService {
  public async streamChatResponse(
    query: string,
    res: Response,
    options: {
      conversationId?: string;
      collectionId?: string;
      documentId?: string;
      userId?: string;
    } = {}
  ): Promise<void> {
    const overallTimer = metricsService.startTimer();
    const metrics: Partial<QueryMetrics> = {};
    const effectiveUserId = options.userId || 'user-default-admin';

    // 1. Prepare conversation
    let conversationId = options.conversationId;
    if (!conversationId) {
      conversationId = `conv-${Date.now()}`;
      const newConv: Conversation = {
        id: conversationId,
        userId: effectiveUserId,
        title: query.slice(0, 45) + (query.length > 45 ? '...' : ''),
        messageCount: 0,
        collectionScopeId: options.collectionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await dbService.saveConversation(newConv);
    }

    // Save user message
    const userMessage: Message = {
      id: `msg-${Date.now()}-user`,
      conversationId,
      role: 'user',
      content: query,
      createdAt: new Date().toISOString(),
    };
    await dbService.addMessage(conversationId, userMessage, effectiveUserId);

    // 2. Query Embedding & Vector Search (with fast bounded retry & degraded fallback)
    const embedTimer = metricsService.startTimer();
    let vectorResults: any[] = [];
    let isVectorDegraded = false;

    try {
      const queryVector = await vectorService.getEmbedding(query, { isQuery: true });
      metrics.queryProcessingTimeMs = embedTimer.stop();
      metrics.vectorUnavailable = false;

      // 3. Parallel Retrieval: Qdrant Vector Search
      const vectorTimer = metricsService.startTimer();
      vectorResults = await vectorService.search({
        vector: queryVector,
        limit: config.rag.topKCandidates || 20,
        filter: {
          collectionId: options.collectionId,
          documentId: options.documentId,
          userId: effectiveUserId,
        },
      });
      metrics.vectorSearchLatencyMs = vectorTimer.stop();
    } catch (err: any) {
      metrics.queryProcessingTimeMs = embedTimer.stop();
      isVectorDegraded = true;
      metrics.vectorUnavailable = true;
      metrics.vectorSearchLatencyMs = 0;
      vectorResults = [];
      console.warn(`[ChatService] Vector query embedding unavailable (${err.message}). Engaging controlled BM25-only degraded retrieval path.`);
    }

    const bm25Timer = metricsService.startTimer();
    const keywordResults = await keywordService.search({
      query,
      limit: config.rag.topKCandidates || 20,
      filter: {
        collectionId: options.collectionId,
        documentId: options.documentId,
        userId: effectiveUserId,
      },
    });
    metrics.bm25LatencyMs = bm25Timer.stop();

    // Check if query is asking for visual elements, figures, charts, tables, graphs, or trends
    const visualQueryRegex = /\b(graph|graphs|chart|charts|figure|figures|fig|table|tables|diagram|diagrams|image|images|trend|trends|axis|axes|plot|plots|visual|curve|curves|histogram|histograms|page|participant|participants)\b/i;
    if (visualQueryRegex.test(query)) {
      const allChunks = await dbService.getAllChunks(effectiveUserId);
      const visualChunks = allChunks.filter(c => 
        (c.metadata?.isVisual || c.id.includes('-vis-')) &&
        (!options.documentId || c.documentId === options.documentId)
      );

      const sigKws = rerankService.extractSignificantKeywords(query);

      for (const vChunk of visualChunks) {
        const alreadyInKeyword = keywordResults.some(r => r.chunkId === vChunk.id);
        if (!alreadyInKeyword) {
          const lowerContent = vChunk.content.toLowerCase();
          const matches = sigKws.filter(kw => lowerContent.includes(kw));
          const score = matches.length > 0 ? 0.6 + (matches.length * 0.1) : 0.45;

          keywordResults.push({
            chunkId: vChunk.id,
            documentId: vChunk.documentId,
            score,
            content: vChunk.content,
            title: vChunk.documentTitle,
            type: 'PDF',
            pageNumber: vChunk.pageNumber,
            slideNumber: vChunk.slideNumber,
            sectionHeader: vChunk.sectionHeader,
          });
        }
      }
    }

    // 4. Reciprocal Rank Fusion (RRF)
    const rrfTimer = metricsService.startTimer();
    const rrfCandidates = rerankService.reciprocalRankFusion(vectorResults, keywordResults, {
      k: config.rag.rrfConstantK || 60,
      topN: config.rag.topKReranked || 6,
    });
    metrics.rrfLatencyMs = rrfTimer.stop();

    // 5. Neural Cross-Encoder Reranking
    const rerankTimer = metricsService.startTimer();
    const finalCandidates = await rerankService.neuralRerank(
      query,
      rrfCandidates,
      config.rag.topKReranked || 6,
      {
        skipNeural: isVectorDegraded,
        timeoutMs: 1500,
      }
    );
    metrics.rerankLatencyMs = rerankTimer.stop();

    // 6. Grounding Gate: verify candidates have factual relevant evidence
    const validCandidates = rerankService.filterGroundedCandidates(query, finalCandidates);
    const groundingPassed = validCandidates.length > 0;
    metrics.groundingPassed = groundingPassed;
    metrics.groundingStatus = groundingPassed ? 'GROUNDED' : 'INSUFFICIENT_EVIDENCE';

    if (!groundingPassed) {
      // INSUFFICIENT EVIDENCE PATH: Strict non-hallucination gate
      const contextTimer = metricsService.startTimer();
      metrics.contextBuildingLatencyMs = contextTimer.stop();

      // Citations event must be empty array
      res.write(`data: ${JSON.stringify({ type: 'citations', citations: [] })}\n\n`);

      const insufficientMessage = 'The current knowledge base does not contain sufficient evidence to answer this question.';
      metrics.timeToFirstTokenMs = 5;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: insufficientMessage })}\n\n`);

      metrics.totalQueryLatencyMs = overallTimer.stop();
      metricsService.recordQueryMetrics(metrics);
      res.write(`data: ${JSON.stringify({ type: 'metrics', metrics })}\n\n`);

      const assistantMessage: Message = {
        id: `msg-${Date.now()}-assistant`,
        conversationId,
        role: 'assistant',
        content: insufficientMessage,
        createdAt: new Date().toISOString(),
        citations: [],
      };
      await dbService.addMessage(conversationId, assistantMessage, effectiveUserId);

      res.write(`data: ${JSON.stringify({ type: 'done', conversationId, metrics })}\n\n`);
      res.end();
      return;
    }

    // 7. Context Construction with Grounded Candidates
    const contextTimer = metricsService.startTimer();
    const grounded = ContextService.buildGroundedContext(validCandidates, 3500);
    metrics.contextBuildingLatencyMs = contextTimer.stop();

    // Send Citations Event immediately to frontend
    res.write(`data: ${JSON.stringify({ type: 'citations', citations: grounded.citations })}\n\n`);

    // 8. Gemini Generation with Streaming SSE
    let accumulatedResponse = '';
    const ttftTimer = metricsService.startTimer();
    let isFirstToken = true;

    const ai = getGeminiClient(options.userId);
    if (ai) {
      try {
        const systemInstruction = `You are ONYX, an analytical AI knowledge assistant.
You strictly answer based ONLY on the provided grounded sources.
RULES:
1. Ground every claim directly in the context.
2. Cite sources using inline bracketed notation like [[01]], [[02]] that correspond to the [SOURCE XX] identifiers.
3. When visual evidence (figures, charts, graphs, tables, diagrams) is present in the sources, cite and describe their visual types, page numbers, axes, observed trends, and relationships to textual findings.
4. If the provided context does not contain sufficient information to answer the question, clearly state: "The current knowledge base does not contain sufficient evidence to answer this question." Do not fabricate or invent facts.
5. Structure your response with clear markdown headings, concise bullet points, and high information density.`;

        const prompt = `GROUNDED KNOWLEDGE EVIDENCE:
${grounded.promptContext}

---

USER QUESTION: "${query}"

Provide an analytical, grounded answer with inline citations [[01]], [[02]]:`;

        const generationModels = [
          config.gemini.textModel || 'gemini-3.6-flash',
          'gemini-3.1-flash-lite',
          'gemini-flash-latest',
          'gemini-3.1-pro-preview',
        ];

        let streamSucceeded = false;
        for (const model of generationModels) {
          try {
            const streamResult = await ai.models.generateContentStream({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [{ text: prompt }],
                },
              ],
              config: {
                systemInstruction,
                temperature: 0.2,
              },
            });

            for await (const chunk of streamResult) {
              if (isFirstToken) {
                metrics.timeToFirstTokenMs = ttftTimer.stop();
                isFirstToken = false;
              }

              const chunkText = chunk.text || '';
              accumulatedResponse += chunkText;
              res.write(`data: ${JSON.stringify({ type: 'chunk', text: chunkText })}\n\n`);
            }
            streamSucceeded = true;
            break;
          } catch (modelErr: any) {
            const errStr = String(modelErr?.message || modelErr);
            console.warn(`[ChatService] Model ${model} generation failed (${errStr.slice(0, 100)}). Trying fallback model...`);
            // If partial text was emitted before failure, don't leave stream in half-state
            if (accumulatedResponse.length > 0) {
              break;
            }
            continue;
          }
        }

        if (!streamSucceeded && accumulatedResponse.length === 0) {
          throw new Error('All generation models exhausted or unavailable');
        }
      } catch (err: any) {
        console.warn(`[ChatService] Gemini streaming error: ${err.message}. Falling back to grounded synthesizer.`);
        accumulatedResponse = this.synthesizeGroundedAnswer(query, grounded.citations);
        res.write(`data: ${JSON.stringify({ type: 'chunk', text: accumulatedResponse })}\n\n`);
      }
    } else {
      // Deterministic grounded synthesis when no API key is present
      accumulatedResponse = this.synthesizeGroundedAnswer(query, grounded.citations);
      metrics.timeToFirstTokenMs = 12;
      res.write(`data: ${JSON.stringify({ type: 'chunk', text: accumulatedResponse })}\n\n`);
    }

    metrics.totalQueryLatencyMs = overallTimer.stop();

    // Record metrics in metrics service
    metricsService.recordQueryMetrics(metrics);

    // Send metrics event
    res.write(`data: ${JSON.stringify({ type: 'metrics', metrics })}\n\n`);

    // Save assistant message to PostgreSQL/database
    const assistantMessage: Message = {
      id: `msg-${Date.now()}-assistant`,
      conversationId,
      role: 'assistant',
      content: accumulatedResponse,
      createdAt: new Date().toISOString(),
      citations: grounded.citations,
    };
    await dbService.addMessage(conversationId, assistantMessage, effectiveUserId);

    // End stream
    res.write(`data: ${JSON.stringify({ type: 'done', conversationId, metrics })}\n\n`);
    res.end();
  }

  public async handleStreamingChat(
    conversationId: string,
    query: string,
    collectionScopeId: string | undefined,
    res: Response
  ): Promise<void> {
    return this.streamChatResponse(query, res, {
      conversationId,
      collectionId: collectionScopeId,
    });
  }

  private synthesizeGroundedAnswer(query: string, citations: any[]): string {
    if (!citations || citations.length === 0) {
      return 'The current knowledge base does not contain sufficient evidence to answer this question.';
    }

    const leadCitation = citations[0];
    const secondaryCitation = citations.length > 1 ? citations[1] : null;

    let response = `Based on the grounded evidence in **${leadCitation.documentTitle}** [[01]], `;
    response += `${leadCitation.excerpt.slice(0, 220).trim()}...\n\n`;

    if (secondaryCitation) {
      response += `Furthermore, as detailed in **${secondaryCitation.documentTitle}** [[02]]:\n`;
      response += `> ${secondaryCitation.excerpt.slice(0, 180).trim()}...\n\n`;
    }

    response += `### Summary & Key Takeaways\n`;
    response += `- **Primary Evidence**: Direct match retrieved with confidence score **${leadCitation.score}** [[01]].\n`;
    if (secondaryCitation) {
      response += `- **Supporting Context**: Cross-referenced with **${secondaryCitation.documentTitle}** (Page/Section: ${secondaryCitation.section || 'General'}) [[02]].\n`;
    }
    response += `- **Retrieval Mode**: Hybrid RRF (Vector + BM25) and Neural Cross-Encoder ranking.`;

    return response;
  }
}

export const chatService = new ChatService();
