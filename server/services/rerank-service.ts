import { getGeminiClient } from '../gemini';
import { config } from '../config';
import { VectorSearchResult, KeywordSearchResult } from '../types';
import { DocumentType } from '../../src/types';
import { dbService } from '../db/database';

export interface RerankedCandidate {
  chunkId: string;
  documentId: string;
  title: string;
  type: DocumentType;
  content: string;
  pageNumber?: number;
  slideNumber?: number;
  sectionHeader?: string;
  vectorRank?: number;
  keywordRank?: number;
  vectorScore?: number;
  keywordScore?: number;
  rrfScore: number;
  neuralRerankScore: number;
  finalScore: number;
  isNeuralEvaluated?: boolean;
  metadata?: Record<string, any>;
  isVisual?: boolean;
  visualType?: string;
  figureId?: string;
  figureTitle?: string;
  axes?: { x?: string; y?: string };
  legend?: string[];
  trendSummary?: string;
  keyValues?: string[];
}

const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'cannot', 'could',
  'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for',
  'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s',
  'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i', 'i\'d', 'i\'ll', 'i\'m',
  'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t',
  'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours',
  'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t',
  'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very', 'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t',
  'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s',
  'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself',
  'yourselves', 'tell', 'show', 'shown', 'shows', 'give', 'find', 'know', 'name', 'explain', 'explains', 'describe',
  'describes', 'identify', 'identifies', 'list', 'lists', 'relate', 'relates', 'related', 'discuss', 'discussed',
  'surround', 'surrounding', 'relevant', 'many', 'much', 'involved', 'mention', 'mentioned', 'contain', 'contains',
  'including', 'includes', 'means', 'meaning', 'based', 'given', 'following'
]);

export class RerankService {
  private primaryModel = config.gemini.textModel || 'gemini-3.6-flash';
  private fallbackModels = [
    config.gemini.textModel || 'gemini-3.6-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest',
    'gemini-3.1-pro-preview',
  ];

  public extractSignificantKeywords(query: string): string[] {
    if (!query) return [];
    return query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w));
  }

  /**
   * Reciprocal Rank Fusion (RRF)
   * Formula: RRF_score(d) = sum_m( w_m / (k + rank_m(d)) )
   */
  public reciprocalRankFusion(
    vectorResults: VectorSearchResult[],
    keywordResults: KeywordSearchResult[],
    options: {
      k?: number;
      vectorWeight?: number;
      keywordWeight?: number;
      topN?: number;
    } = {}
  ): RerankedCandidate[] {
    const k = options.k || config.rag.rrfConstantK || 60;
    const wV = options.vectorWeight || 1.0;
    const wK = options.keywordWeight || 1.0;
    const topN = options.topN || config.rag.topKReranked || 6;

    const candidateMap = new Map<string, RerankedCandidate>();

    // 1. Ingest vector results
    vectorResults.forEach((res, rank) => {
      const rrfScore = wV / (k + rank + 1);
      const chunkRecord = dbService.chunks.get(res.chunkId);
      candidateMap.set(res.chunkId, {
        chunkId: res.chunkId,
        documentId: res.documentId,
        title: res.payload.title,
        type: res.payload.type,
        content: res.payload.content,
        pageNumber: res.payload.pageNumber,
        slideNumber: res.payload.slideNumber,
        sectionHeader: res.payload.sectionHeader,
        vectorRank: rank + 1,
        vectorScore: res.score,
        rrfScore,
        neuralRerankScore: 0,
        finalScore: rrfScore,
        isNeuralEvaluated: false,
        metadata: chunkRecord?.metadata,
        isVisual: chunkRecord?.metadata?.isVisual,
        visualType: chunkRecord?.metadata?.figureType || chunkRecord?.metadata?.visualType,
        figureId: chunkRecord?.metadata?.figureId,
        figureTitle: chunkRecord?.metadata?.figureTitle,
        axes: chunkRecord?.metadata?.axes,
        legend: chunkRecord?.metadata?.legend,
        trendSummary: chunkRecord?.metadata?.trendSummary,
        keyValues: chunkRecord?.metadata?.keyValues,
      });
    });

    // 2. Fuse keyword results
    keywordResults.forEach((res, rank) => {
      const rrfAddition = wK / (k + rank + 1);
      const chunkRecord = dbService.chunks.get(res.chunkId);
      if (candidateMap.has(res.chunkId)) {
        const existing = candidateMap.get(res.chunkId)!;
        existing.keywordRank = rank + 1;
        existing.keywordScore = res.score;
        existing.rrfScore += rrfAddition;
        existing.finalScore = existing.rrfScore;
        if (!existing.metadata && chunkRecord?.metadata) {
          existing.metadata = chunkRecord.metadata;
          existing.isVisual = chunkRecord.metadata.isVisual;
          existing.visualType = chunkRecord.metadata.figureType || chunkRecord.metadata.visualType;
          existing.figureId = chunkRecord.metadata.figureId;
          existing.figureTitle = chunkRecord.metadata.figureTitle;
          existing.axes = chunkRecord.metadata.axes;
          existing.legend = chunkRecord.metadata.legend;
          existing.trendSummary = chunkRecord.metadata.trendSummary;
          existing.keyValues = chunkRecord.metadata.keyValues;
        }
      } else {
        candidateMap.set(res.chunkId, {
          chunkId: res.chunkId,
          documentId: res.documentId,
          title: res.title,
          type: res.type,
          content: res.content,
          pageNumber: res.pageNumber,
          slideNumber: res.slideNumber,
          sectionHeader: res.sectionHeader,
          keywordRank: rank + 1,
          keywordScore: res.score,
          rrfScore: rrfAddition,
          neuralRerankScore: 0,
          finalScore: rrfAddition,
          isNeuralEvaluated: false,
          metadata: chunkRecord?.metadata,
          isVisual: chunkRecord?.metadata?.isVisual,
          visualType: chunkRecord?.metadata?.figureType || chunkRecord?.metadata?.visualType,
          figureId: chunkRecord?.metadata?.figureId,
          figureTitle: chunkRecord?.metadata?.figureTitle,
          axes: chunkRecord?.metadata?.axes,
          legend: chunkRecord?.metadata?.legend,
          trendSummary: chunkRecord?.metadata?.trendSummary,
          keyValues: chunkRecord?.metadata?.keyValues,
        });
      }
    });

    const candidates = Array.from(candidateMap.values());
    candidates.sort((a, b) => b.rrfScore - a.rrfScore);

    return candidates.slice(0, topN * 2); // Return top candidate pool for neural reranking
  }

  /**
   * Neural Cross-Encoder Reranking
   * Uses joint query-passage cross-attention scoring
   */
  public async neuralRerank(
    query: string,
    candidates: RerankedCandidate[],
    topK = 6,
    options?: { timeoutMs?: number; skipNeural?: boolean }
  ): Promise<RerankedCandidate[]> {
    if (candidates.length === 0) return [];
    if (options?.skipNeural || candidates.length <= 1) {
      return candidates.slice(0, topK);
    }
    const ai = getGeminiClient();
    if (!ai) {
      return candidates.slice(0, topK);
    }

    if (ai) {
      try {
        const timeoutMs = options?.timeoutMs || 4000;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Neural reranking timed out')), timeoutMs)
        );

        const candidateDescriptions = candidates
          .map((c, i) => `[PASSAGE ${i + 1}]\n${c.content.slice(0, 350)}`)
          .join('\n\n---\n\n');

        const prompt = `You are a state-of-the-art Neural Cross-Encoder Reranker.
Evaluate the direct semantic relevance of each passage to the User Query.
Assign a relevance score from 0.0 (completely irrelevant) to 1.0 (exact answer match).

USER QUERY: "${query}"

PASSAGES TO SCORE:
${candidateDescriptions}

Return ONLY a JSON array of objects with "passageIndex" (1-indexed) and "relevanceScore" (0.0 to 1.0).
Example: [{"passageIndex": 1, "relevanceScore": 0.95}, {"passageIndex": 2, "relevanceScore": 0.42}]`;

        let response: any = null;
        for (const model of this.fallbackModels) {
          try {
            const generatePromise = ai.models.generateContent({
              model,
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                temperature: 0.1,
              },
            });
            response = await Promise.race([generatePromise, timeoutPromise]);
            if (response?.text) break;
          } catch (modelErr: any) {
            // Try next model if quota or unavailable
            continue;
          }
        }

        const text = response?.text || '[]';
        const parsed = JSON.parse(text);

        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((item: any) => {
            const idx = item.passageIndex - 1;
            if (idx >= 0 && idx < candidates.length) {
              const score = typeof item.relevanceScore === 'number' ? Math.max(0, Math.min(1, item.relevanceScore)) : 0.0;
              candidates[idx].neuralRerankScore = score;
              candidates[idx].isNeuralEvaluated = true;
              // Combined score: 70% Neural Cross-Encoder, 30% Normalized RRF
              candidates[idx].finalScore = score * 0.7 + (candidates[idx].rrfScore * 10) * 0.3;
            }
          });

          candidates.sort((a, b) => b.finalScore - a.finalScore);
          return candidates.slice(0, topK);
        }
      } catch (err: any) {
        console.warn(`[RerankService] Neural cross-encoder failed: ${err.message}. Relying on fallback ranking.`);
      }
    }

    // Fallback: algorithmic semantic alignment score
    const sigKeywords = this.extractSignificantKeywords(query);
    candidates.forEach(c => {
      const text = `${c.title} ${c.sectionHeader || ''} ${c.content}`.toLowerCase();
      let matchCount = 0;
      for (const w of sigKeywords) {
        if (text.includes(w)) matchCount++;
      }
      const matchRatio = sigKeywords.length > 0 ? matchCount / sigKeywords.length : 0.0;
      c.neuralRerankScore = matchRatio;
      c.isNeuralEvaluated = false;
      c.finalScore = c.rrfScore * 0.5 + matchRatio * 0.5;
    });

    candidates.sort((a, b) => b.finalScore - a.finalScore);
    return candidates.slice(0, topK);
  }

  /**
   * Grounding Gate: Evaluates candidate pool against conservative relevance criteria.
   * Rejects chunks that do not provide verified factual evidence for the query.
   */
  public filterGroundedCandidates(
    query: string,
    candidates: RerankedCandidate[],
    options?: { minNeuralScore?: number }
  ): RerankedCandidate[] {
    if (!candidates || candidates.length === 0) return [];

    const minNeuralScore = options?.minNeuralScore ?? 0.40;
    const sigKeywords = this.extractSignificantKeywords(query);

    return candidates.filter(cand => {
      // 1. If Neural Cross-Encoder evaluated the candidate:
      if (cand.isNeuralEvaluated) {
        return cand.neuralRerankScore >= minNeuralScore;
      }

      // 2. Degraded / Fallback algorithmic verification:
      if (sigKeywords.length === 0) {
        return (
          (cand.vectorScore !== undefined && cand.vectorScore >= 0.75) ||
          (cand.keywordScore !== undefined && cand.keywordScore >= 0.7)
        );
      }

      const searchableText = `${cand.title} ${cand.sectionHeader || ''} ${cand.content}`.toLowerCase();
      let matchedCount = 0;
      for (const kw of sigKeywords) {
        if (searchableText.includes(kw)) {
          matchedCount++;
        }
      }

      const matchRatio = matchedCount / sigKeywords.length;

      // Single-keyword query
      if (sigKeywords.length === 1) {
        return matchedCount >= 1 && (
          (cand.vectorScore !== undefined && cand.vectorScore >= 0.65) ||
          (cand.keywordScore !== undefined && cand.keywordScore >= 0.20) ||
          cand.rrfScore > 0.012
        );
      }

      // 2 to 3 keyword query
      if (sigKeywords.length <= 3) {
        return (
          matchedCount >= 2 ||
          (matchedCount >= 1 && cand.vectorScore !== undefined && cand.vectorScore >= 0.70) ||
          (matchedCount >= 1 && cand.keywordScore !== undefined && cand.keywordScore >= 0.20) ||
          (matchedCount >= 1 && (cand.keywordRank === 1 || cand.vectorRank === 1))
        );
      }

      // 4+ keywords query: must match at least 2 distinct significant keywords and >= 35% of keywords
      return matchedCount >= 2 && matchRatio >= 0.35;
    });
  }
}

export const rerankService = new RerankService();
