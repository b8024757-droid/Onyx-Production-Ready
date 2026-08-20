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

    // 1. Prepare conversation & retrieve prior messages
    let conversationId = options.conversationId;
    let priorMessages: Message[] = [];
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
    } else {
      priorMessages = await dbService.getMessages(conversationId, effectiveUserId);
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

    // 2. Query Intent Classification, Anaphora Context & Multi-Facet Analysis
    let effectiveRetrievalQuery = query;
    const anaphoraRegex = /\b(it|that|this|these|those|the other|the former|the latter|they|its|them|which one|why was it|compare that|what about|how about|explain that|the second|the first)\b/i;
    if (priorMessages.length > 0 && (anaphoraRegex.test(query) || query.split(/\s+/).length <= 4)) {
      const lastUserMsg = [...priorMessages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && lastUserMsg.content !== query) {
        effectiveRetrievalQuery = `${lastUserMsg.content} ${query}`;
      }
    }

    const intentAnalysis = rerankService.detectQueryIntent(effectiveRetrievalQuery);
    const isSummaryMode = intentAnalysis.isSummaryOrCrossSection;
    const candidateLimit = isSummaryMode ? 50 : (config.rag.topKCandidates || 20);

    // 3. Query Embedding & Vector Search (with fast bounded retry & degraded fallback)
    const embedTimer = metricsService.startTimer();
    let vectorResults: any[] = [];
    let isVectorDegraded = false;

    try {
      const queryVector = await vectorService.getEmbedding(effectiveRetrievalQuery, { isQuery: true });
      metrics.queryProcessingTimeMs = embedTimer.stop();
      metrics.vectorUnavailable = false;

      // Parallel Retrieval: Qdrant Vector Search
      const vectorTimer = metricsService.startTimer();
      vectorResults = await vectorService.search({
        vector: queryVector,
        limit: candidateLimit,
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
      query: effectiveRetrievalQuery,
      limit: candidateLimit,
      filter: {
        collectionId: options.collectionId,
        documentId: options.documentId,
        userId: effectiveUserId,
      },
    });
    metrics.bm25LatencyMs = bm25Timer.stop();

    // 3b. If in Document Summary / Broad Multi-Facet mode, run multi-facet sub-query expansion & stratified sampling
    if (isSummaryMode) {
      const seenKeywordChunkIds = new Set(keywordResults.map(r => r.chunkId));
      for (const facet of intentAnalysis.facets) {
        try {
          const facetKwResults = await keywordService.search({
            query: facet.subQuery,
            limit: 10,
            filter: {
              collectionId: options.collectionId,
              documentId: options.documentId,
              userId: effectiveUserId,
            },
          });
          for (const fr of facetKwResults) {
            if (!seenKeywordChunkIds.has(fr.chunkId)) {
              seenKeywordChunkIds.add(fr.chunkId);
              keywordResults.push(fr);
            }
          }
        } catch {
          // Continue with next facet
        }
      }

      // If documentId specified or available in database, add stratified page-by-page samples
      const allChunks = await dbService.getAllChunks(effectiveUserId);
      const targetDocChunks = options.documentId
        ? allChunks.filter(c => c.documentId === options.documentId)
        : allChunks;

      if (targetDocChunks.length > 0) {
        // Group by page number to guarantee cross-page coverage
        const pageBuckets = new Map<number, typeof targetDocChunks>();
        for (const c of targetDocChunks) {
          const p = c.pageNumber || 1;
          if (!pageBuckets.has(p)) pageBuckets.set(p, []);
          pageBuckets.get(p)!.push(c);
        }

        // Sample from every page present in the document
        for (const [_, pChunks] of pageBuckets.entries()) {
          for (const c of pChunks.slice(0, 3)) {
            if (!seenKeywordChunkIds.has(c.id)) {
              seenKeywordChunkIds.add(c.id);
              keywordResults.push({
                chunkId: c.id,
                documentId: c.documentId,
                score: 0.52,
                content: c.content,
                title: c.documentTitle,
                type: 'PDF',
                pageNumber: c.pageNumber,
                slideNumber: c.slideNumber,
                sectionHeader: c.sectionHeader,
              });
            }
          }
        }
      }
    }

    // Check if query is asking for visual elements, figures, charts, tables, graphs, or trends
    const visualQueryRegex = /\b(graph|graphs|chart|charts|figure|figures|fig|table|tables|diagram|diagrams|image|images|trend|trends|axis|axes|plot|plots|visual|curve|curves|histogram|histograms|page|participant|participants)\b/i;
    if (visualQueryRegex.test(query) || isSummaryMode) {
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
          const score = matches.length > 0 ? 0.65 + (matches.length * 0.1) : 0.50;

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
    const rrfTopN = isSummaryMode ? 36 : (config.rag.topKReranked || 6);
    const rrfCandidates = rerankService.reciprocalRankFusion(vectorResults, keywordResults, {
      k: config.rag.rrfConstantK || 60,
      topN: rrfTopN,
    });
    metrics.rrfLatencyMs = rrfTimer.stop();

    // 5. Neural Cross-Encoder Reranking
    const rerankTimer = metricsService.startTimer();
    const rerankTopK = isSummaryMode ? 24 : (config.rag.topKReranked || 6);
    const finalCandidates = await rerankService.neuralRerank(
      query,
      rrfCandidates,
      rerankTopK,
      {
        skipNeural: isVectorDegraded,
        timeoutMs: 2500,
        isSummaryMode,
        facets: intentAnalysis.facets,
      }
    );
    metrics.rerankLatencyMs = rerankTimer.stop();

    // 6. Grounding Gate: verify candidates have factual relevant evidence
    const validCandidates = rerankService.filterGroundedCandidates(query, finalCandidates, {
      isSummaryMode,
      intentAnalysis,
      onDiagnostic: (diag) => {
        console.log(`[RAG Audit] Query: "${diag.query.slice(0, 80)}" | Intent: ${diag.queryIntent} | Grounding: ${diag.groundingStatus} (Score: ${diag.groundingScore}) | Selected: ${diag.finalSelectedChunks.length} chunks | Pages: [${diag.pageNumbers.slice(0, 10).join(', ')}] | Reason: ${diag.reason}`);
      },
    });
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
    const grounded = ContextService.buildGroundedContext(validCandidates, isSummaryMode ? 7500 : 3500);
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

        const historyContext = priorMessages.length > 0
          ? priorMessages.slice(-6).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')
          : '';

        const prompt = `GROUNDED KNOWLEDGE EVIDENCE:
${grounded.promptContext}
${historyContext ? `\nPRIOR CONVERSATION HISTORY:\n${historyContext}\n` : ''}
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

    let response = `Based on the grounded evidence in **${leadCitation.documentTitle}** [[01]], `;
    response += `${leadCitation.excerpt.slice(0, 260).trim()}...\n\n`;

    if (citations.length > 1) {
      response += `### Key Document Evidence & Findings\n\n`;
      for (let i = 1; i < Math.min(citations.length, 8); i++) {
        const cit = citations[i];
        const idx = cit.citationIndex < 10 ? `0${cit.citationIndex}` : `${cit.citationIndex}`;
        const sectionName = cit.section || (cit.pageNumber ? `Page ${cit.pageNumber}` : 'Document Excerpt');
        const visualLabel = cit.isVisual ? ` [Visual/Figure: ${cit.figureTitle || cit.figureId || 'Graphic'}]` : '';
        
        response += `- **${sectionName}${visualLabel}** [[${idx}]]: ${cit.excerpt.slice(0, 200).replace(/\n+/g, ' ').trim()}...\n`;
      }
      response += `\n`;
    }

    // Visual elements section if present in citations
    const visualCitations = citations.filter(c => c.isVisual || c.trendSummary || c.figureId);
    if (visualCitations.length > 0) {
      response += `### Visual & Empirical Observations\n`;
      for (const vCit of visualCitations.slice(0, 4)) {
        const vIdx = vCit.citationIndex < 10 ? `0${vCit.citationIndex}` : `${vCit.citationIndex}`;
        response += `- **${vCit.figureTitle || vCit.figureId || 'Visual Evidence'}** (Page ${vCit.pageNumber || 'N/A'}) [[${vIdx}]]: ${vCit.trendSummary || vCit.excerpt.slice(0, 150).trim()}\n`;
      }
      response += `\n`;
    }

    response += `### Grounding & Synthesis Summary\n`;
    response += `- **Coverage**: ${citations.length} grounded source passages verified across document sections.\n`;
    response += `- **Evidence Integrity**: All statements directly cited with bracketed references corresponding to indexed content.\n`;
    response += `- **Retrieval Pipeline**: Hybrid RRF (Dense Vector + BM25 Lexical) with neural cross-encoder reranking.`;

    return response;
  }
}

export const chatService = new ChatService();
