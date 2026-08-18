import { Router, Request, Response } from 'express';
import { vectorService } from '../services/vector-service';
import { keywordService } from '../services/keyword-service';
import { rerankService } from '../services/rerank-service';
import { ContextService } from '../services/context-service';
import { metricsService } from '../services/metrics-service';
import { optionalAuth } from '../middleware/auth';
import { config } from '../config';

export const searchRouter = Router();

// Enable user context resolution
searchRouter.use(optionalAuth);

const handleSearch = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const query = (req.body?.query || req.query.q || '') as string;
    const collectionId = (req.body?.collectionId || req.query.collectionId) as string;
    const documentId = (req.body?.documentId || req.query.documentId) as string;
    const limit = parseInt((req.body?.limit || req.query.limit || '10') as string, 10);

    if (!query || query.trim().length === 0) {
      return res.json({ results: [], citations: [], metrics: {} });
    }

    const overallTimer = metricsService.startTimer();
    const metrics: any = {};
    let vectorResults: any[] = [];
    let isVectorDegraded = false;
    let vectorErrorMsg = '';

    // 1. Query Embedding & Vector Search with Controlled Fallback
    const embedTimer = metricsService.startTimer();
    try {
      const queryVector = await vectorService.getEmbedding(query, { isQuery: true });
      metrics.queryEmbeddingLatencyMs = embedTimer.stop();

      const vectorTimer = metricsService.startTimer();
      vectorResults = await vectorService.search({
        vector: queryVector,
        limit: config.rag.topKCandidates || 20,
        filter: { collectionId, documentId, userId },
      });
      metrics.vectorSearchLatencyMs = vectorTimer.stop();
      metrics.vectorRetrievalStatus = 'OPERATIONAL';
      metrics.vectorUnavailable = false;
    } catch (err: any) {
      metrics.queryEmbeddingLatencyMs = embedTimer.stop();
      isVectorDegraded = true;
      vectorErrorMsg = err.message || 'Query embedding failed';
      metrics.vectorRetrievalStatus = 'DEGRADED_UNAVAILABLE';
      metrics.vectorRetrievalError = vectorErrorMsg;
      metrics.vectorUnavailable = true;
      metrics.vectorSearchLatencyMs = 0;
      vectorResults = [];
      console.warn(`[Search] Vector search unavailable (${vectorErrorMsg}). Falling back to BM25 lexical index.`);
    }

    // 2. BM25 Sparse Search
    const bm25Timer = metricsService.startTimer();
    const keywordResults = await keywordService.search({
      query,
      limit: config.rag.topKCandidates || 20,
      filter: { collectionId, documentId, userId },
    });
    metrics.bm25LatencyMs = bm25Timer.stop();

    // 3. RRF Fusion (Cleanly fuses available candidate sets)
    const rrfTimer = metricsService.startTimer();
    const rrfCandidates = rerankService.reciprocalRankFusion(vectorResults, keywordResults, {
      k: config.rag.rrfConstantK || 60,
      topN: limit * 2,
    });
    metrics.rrfLatencyMs = rrfTimer.stop();

    // 4. Neural Cross-Encoder Reranking
    const rerankTimer = metricsService.startTimer();
    const finalCandidates = await rerankService.neuralRerank(query, rrfCandidates, limit, {
      skipNeural: isVectorDegraded,
      timeoutMs: 1500,
    });
    metrics.rerankLatencyMs = rerankTimer.stop();

    // Grounding Gate Filter
    const validCandidates = rerankService.filterGroundedCandidates(query, finalCandidates);
    const groundingPassed = validCandidates.length > 0;
    metrics.groundingPassed = groundingPassed;
    metrics.groundingStatus = groundingPassed ? 'GROUNDED' : 'INSUFFICIENT_EVIDENCE';

    // 5. Context & Citations
    const grounded = ContextService.buildGroundedContext(validCandidates, 3000);
    metrics.totalQueryLatencyMs = overallTimer.stop();

    // 6. Format Search Results
    const searchHits = validCandidates.map(res => ({
      chunkId: res.chunkId,
      documentId: res.documentId,
      documentTitle: res.title,
      documentType: res.type,
      content: res.content,
      pageNumber: res.pageNumber,
      slideNumber: res.slideNumber,
      sectionHeader: res.sectionHeader,
      score: Math.round(res.finalScore * 100) / 100,
      vectorScore: res.vectorScore ? Math.round(res.vectorScore * 100) / 100 : undefined,
      keywordScore: res.keywordScore ? Math.round(res.keywordScore * 100) / 100 : undefined,
      rrfScore: Math.round(res.rrfScore * 1000) / 1000,
      neuralRerankScore: res.neuralRerankScore ? Math.round(res.neuralRerankScore * 100) / 100 : undefined,
    }));

    res.json({
      results: searchHits,
      citations: grounded.citations,
      metrics,
      retrievalMode: isVectorDegraded ? 'DEGRADED_BM25_ONLY' : 'HYBRID_VECTOR_BM25',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

searchRouter.get('/', handleSearch);
searchRouter.post('/', handleSearch);
