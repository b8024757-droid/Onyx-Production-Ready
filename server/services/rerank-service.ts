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
  matchedFacets?: string[];
  bestFacetScore?: number;
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

export type QueryIntent =
  | 'DOCUMENT_SUMMARY'
  | 'CROSS_SECTION'
  | 'SECTION_SPECIFIC'
  | 'FACTUAL';

export interface SummaryFacet {
  name: string;
  label: string;
  terms: string[];
  subQuery: string;
  priority: number;
}

export interface QueryIntentAnalysis {
  intent: QueryIntent;
  isSummaryOrCrossSection: boolean;
  facets: SummaryFacet[];
  targetSections: string[];
  namedEntities: string[];
  rawKeywords: string[];
}

export interface RAGDiagnosticLog {
  query: string;
  queryIntent: QueryIntent;
  isSummaryMode: boolean;
  retrievedChunkIds: string[];
  pageNumbers: number[];
  similarityScores: number[];
  bm25Scores: number[];
  rrfScores: number[];
  rerankerScores: number[];
  finalSelectedChunks: Array<{
    chunkId: string;
    pageNumber?: number;
    sectionHeader?: string;
    finalScore: number;
    matchedFacets?: string[];
  }>;
  groundingScore: number;
  groundingStatus: 'GROUNDED' | 'INSUFFICIENT_EVIDENCE';
  reason: string;
  timestamp: string;
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
  private primaryModel = config.gemini.textModel || 'gemini-3.7-flash';
  private fallbackModels = [
    config.gemini.textModel || 'gemini-3.7-flash',
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
   * Intelligently classifies the user query intent to determine whether
   * a high-coverage multi-section summary pipeline or high-precision factual pipeline is required.
   */
  public detectQueryIntent(query: string): QueryIntentAnalysis {
    const rawKeywords = this.extractSignificantKeywords(query);
    const lower = query.toLowerCase();

    // Structural domain definitions
    const domainIntro = /\b(intro|introduction|background|motivation|problem|objective|purpose|context|abstract|overview)\b/i;
    const domainMethod = /\b(method|methodology|approach|model|models|architecture|algorithm|algorithms|framework|technique|hmm|crf|markov|neural|classifier|process|pipeline)\b/i;
    const domainExperiment = /\b(experiment|experiments|experimental|sensor|sensors|data|dataset|hardware|device|setup|subjects|participants|wearable|benchmark|protocol)\b/i;
    const domainResults = /\b(result|results|performance|accuracy|f1|precision|recall|metric|metrics|findings|evaluation|outcome|score|scores|comparison)\b/i;
    const domainLimitations = /\b(limitation|limitations|drawback|drawbacks|challenge|challenges|discussion|weakness|weaknesses|future work|constraint|constraints|caveat)\b/i;
    const domainConclusion = /\b(conclusion|conclusions|conclude|concluded|wrap up|summary|takeaways|takeaway)\b/i;

    const matchedDomains: string[] = [];
    if (domainIntro.test(query)) matchedDomains.push('intro');
    if (domainMethod.test(query)) matchedDomains.push('method');
    if (domainExperiment.test(query)) matchedDomains.push('experiment');
    if (domainResults.test(query)) matchedDomains.push('results');
    if (domainLimitations.test(query)) matchedDomains.push('limitations');
    if (domainConclusion.test(query)) matchedDomains.push('conclusion');

    // Whole-document summary indicators
    const isExplicitSummary = /\b(summarize|summary|overview|outline|entire paper|whole paper|entire document|whole document|all sections|synopsis|briefing|executive summary|main takeaways|core findings|what is this (paper|document) about|explain the paper)\b/i.test(query);

    let intent: QueryIntent = 'FACTUAL';
    if (isExplicitSummary || matchedDomains.length >= 3) {
      intent = 'DOCUMENT_SUMMARY';
    } else if (matchedDomains.length >= 2) {
      intent = 'CROSS_SECTION';
    } else if (matchedDomains.length === 1 && !/\b(what is|who is|when did|where is|how many|which specific)\b/i.test(query)) {
      intent = 'SECTION_SPECIFIC';
    }

    const isSummaryOrCrossSection = intent === 'DOCUMENT_SUMMARY' || intent === 'CROSS_SECTION';
    const facets = this.decomposeSummaryFacets(query, intent, matchedDomains);

    // Extract named entities / technical terms (e.g., HMM, CRF, sensors, specific model names)
    const technicalTerms = query
      .match(/\b([A-Z]{2,}|[a-z]{3,}(?:-[a-z0-9]+)?)\b/g)
      ?.filter(t => !STOPWORDS.has(t.toLowerCase()) && t.length >= 3) || [];

    return {
      intent,
      isSummaryOrCrossSection,
      facets,
      targetSections: matchedDomains,
      namedEntities: Array.from(new Set(technicalTerms)),
      rawKeywords,
    };
  }

  /**
   * Decomposes broad summary and cross-section queries into targeted structural facets.
   */
  public decomposeSummaryFacets(
    query: string,
    intent: QueryIntent,
    matchedDomains: string[]
  ): SummaryFacet[] {
    const facets: SummaryFacet[] = [];
    const lower = query.toLowerCase();

    // 1. Overview / Introduction / Motivation
    facets.push({
      name: 'overview',
      label: 'Introduction & Motivation',
      terms: ['abstract', 'introduction', 'background', 'motivation', 'problem', 'purpose', 'overview'],
      subQuery: 'problem statement motivation background overview introduction',
      priority: 1,
    });

    // 2. Methodology & Modeling (e.g., HMM, CRF, algorithms)
    const methodTerms = ['methodology', 'method', 'approach', 'model', 'algorithm', 'architecture'];
    if (lower.includes('hmm') || lower.includes('markov')) methodTerms.push('hmm', 'hidden markov model', 'markov');
    if (lower.includes('crf') || lower.includes('conditional random')) methodTerms.push('crf', 'conditional random field');
    facets.push({
      name: 'methodology',
      label: 'Methodology & Models',
      terms: methodTerms,
      subQuery: `methodology approach model algorithm ${methodTerms.slice(6).join(' ')}`.trim(),
      priority: 2,
    });

    // 3. Experiments & Data / Sensors
    const expTerms = ['experiment', 'experimental', 'dataset', 'data', 'evaluation', 'setup'];
    if (lower.includes('sensor')) expTerms.push('sensor', 'sensors', 'wearable', 'hardware');
    if (lower.includes('participant') || lower.includes('subject')) expTerms.push('participants', 'subjects');
    facets.push({
      name: 'experiment',
      label: 'Experimental Setup & Sensors',
      terms: expTerms,
      subQuery: `experimental setup data collection sensors hardware ${expTerms.slice(6).join(' ')}`.trim(),
      priority: 3,
    });

    // 4. Major Results & Performance
    facets.push({
      name: 'results',
      label: 'Major Results & Evaluation',
      terms: ['results', 'performance', 'accuracy', 'metrics', 'findings', 'comparison', 'evaluation', 'f1'],
      subQuery: 'major results performance accuracy empirical findings metrics comparison',
      priority: 4,
    });

    // 5. Discussion & Limitations
    facets.push({
      name: 'limitations',
      label: 'Limitations & Discussion',
      terms: ['limitations', 'challenges', 'discussion', 'weaknesses', 'drawbacks', 'trade-offs', 'constraints'],
      subQuery: 'limitations challenges weaknesses drawbacks discussion',
      priority: 5,
    });

    // 6. Conclusion & Takeaways
    facets.push({
      name: 'conclusion',
      label: 'Conclusion & Future Work',
      terms: ['conclusion', 'conclusions', 'summary', 'future work', 'key takeaways', 'concluding'],
      subQuery: 'conclusion future work summary core takeaways',
      priority: 6,
    });

    // If query explicitly asked for specific concepts (like sensors, HMM, CRF, limitations), boost priority
    facets.forEach(f => {
      if (f.terms.some(t => lower.includes(t))) {
        f.priority -= 0.5;
      }
    });

    facets.sort((a, b) => a.priority - b.priority);
    return facets;
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
        title: res.payload?.title || 'Knowledge Document',
        type: res.payload?.type || 'PDF',
        content: res.payload?.content || '',
        pageNumber: res.payload?.pageNumber,
        slideNumber: res.payload?.slideNumber,
        sectionHeader: res.payload?.sectionHeader,
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
          title: res.title || 'Knowledge Document',
          type: res.type || 'PDF',
          content: res.content || '',
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

    return candidates.slice(0, topN * 2);
  }

  /**
   * Neural Cross-Encoder Reranking
   * Uses joint query-passage cross-attention scoring with multi-section summary awareness.
   */
  public async neuralRerank(
    query: string,
    candidates: RerankedCandidate[],
    topK = 6,
    options?: {
      timeoutMs?: number;
      skipNeural?: boolean;
      isSummaryMode?: boolean;
      facets?: SummaryFacet[];
    }
  ): Promise<RerankedCandidate[]> {
    if (candidates.length === 0) return [];
    if (options?.skipNeural || candidates.length <= 1) {
      return this.balanceCandidatesAcrossSections(candidates.slice(0, topK), topK, options?.facets);
    }

    const ai = getGeminiClient();
    const isSummary = options?.isSummaryMode ?? false;

    if (ai) {
      try {
        const timeoutMs = options?.timeoutMs || 4000;
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Neural reranking timed out')), timeoutMs)
        );

        const candidateDescriptions = candidates
          .slice(0, 24)
          .map((c, i) => `[PASSAGE ${i + 1}] (Section: ${c.sectionHeader || 'General'}, Page: ${c.pageNumber || 1})\n${c.content.slice(0, 350)}`)
          .join('\n\n---\n\n');

        let prompt = '';
        if (isSummary) {
          prompt = `You are an expert Neural Cross-Encoder Reranker specialized in comprehensive document summarization and multi-section synthesis.
Evaluate how informatively and substantively each passage provides grounded evidence for key structural facets of the document (Overview, Methodology, Experiments/Sensors, Models like HMM/CRF, Results, Limitations, Conclusion) or directly answers aspects of the User Query.
Assign a relevance score from 0.0 (irrelevant) to 1.0 (highly informative representative evidence).

USER QUERY: "${query}"

PASSAGES TO SCORE:
${candidateDescriptions}

Return ONLY a JSON array of objects with "passageIndex" (1-indexed) and "relevanceScore" (0.0 to 1.0).
Example: [{"passageIndex": 1, "relevanceScore": 0.92}, {"passageIndex": 2, "relevanceScore": 0.65}]`;
        } else {
          prompt = `You are a state-of-the-art Neural Cross-Encoder Reranker.
Evaluate the direct semantic relevance of each passage to the User Query.
Assign a relevance score from 0.0 (completely irrelevant) to 1.0 (exact answer match).

USER QUERY: "${query}"

PASSAGES TO SCORE:
${candidateDescriptions}

Return ONLY a JSON array of objects with "passageIndex" (1-indexed) and "relevanceScore" (0.0 to 1.0).
Example: [{"passageIndex": 1, "relevanceScore": 0.95}, {"passageIndex": 2, "relevanceScore": 0.42}]`;
        }

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
          } catch {
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
              candidates[idx].finalScore = score * 0.7 + (candidates[idx].rrfScore * 10) * 0.3;
            }
          });

          // Tag facets for summary mode
          this.tagCandidateFacets(candidates, options?.facets);

          candidates.sort((a, b) => b.finalScore - a.finalScore);
          return this.balanceCandidatesAcrossSections(candidates, topK, options?.facets);
        }
      } catch (err: any) {
        console.warn(`[RerankService] Neural cross-encoder fallback: ${err.message}`);
      }
    }

    // Fallback: Algorithmic facet-aware semantic alignment
    this.tagCandidateFacets(candidates, options?.facets);

    const sigKeywords = this.extractSignificantKeywords(query);
    candidates.forEach(c => {
      const text = `${c.title} ${c.sectionHeader || ''} ${c.content}`.toLowerCase();
      let matchCount = 0;
      for (const w of sigKeywords) {
        if (text.includes(w)) matchCount++;
      }
      const matchRatio = sigKeywords.length > 0 ? matchCount / sigKeywords.length : 0.0;
      
      const bestFacetScore = c.bestFacetScore || 0;
      const combinedAlgorithmic = isSummary
        ? Math.max(bestFacetScore * 0.7, matchRatio * 0.5)
        : matchRatio;

      c.neuralRerankScore = combinedAlgorithmic;
      c.isNeuralEvaluated = false;
      c.finalScore = c.rrfScore * 0.4 + combinedAlgorithmic * 0.6;
    });

    candidates.sort((a, b) => b.finalScore - a.finalScore);
    return this.balanceCandidatesAcrossSections(candidates, topK, options?.facets);
  }

  /**
   * Tags candidate chunks with the structural facets they satisfy (Overview, Methods, Experiments, Results, Limitations, Conclusion).
   */
  private tagCandidateFacets(candidates: RerankedCandidate[], facets?: SummaryFacet[]): void {
    const activeFacets = facets || this.decomposeSummaryFacets('', 'DOCUMENT_SUMMARY', []);

    candidates.forEach(cand => {
      const text = `${cand.title} ${cand.sectionHeader || ''} ${cand.content}`.toLowerCase();
      const matched: string[] = [];
      let bestScore = 0;

      for (const f of activeFacets) {
        let facetMatches = 0;
        for (const term of f.terms) {
          if (text.includes(term.toLowerCase())) {
            facetMatches++;
          }
        }
        if (facetMatches > 0) {
          matched.push(f.name);
          const fScore = Math.min(1.0, (facetMatches / Math.max(2, f.terms.length * 0.5)) + 0.2);
          if (fScore > bestScore) bestScore = fScore;
        }
      }

      // Also check page / section position heuristics if sectionHeader is missing
      if (cand.pageNumber !== undefined) {
        if (cand.pageNumber <= 2 && !matched.includes('overview')) matched.push('overview');
      }

      cand.matchedFacets = matched;
      cand.bestFacetScore = bestScore;
    });
  }

  /**
   * Balances selected candidate pool across distinct document sections/pages
   * so a document summary receives evidence from all critical parts rather than 1 page.
   */
  private balanceCandidatesAcrossSections(
    candidates: RerankedCandidate[],
    topK: number,
    facets?: SummaryFacet[]
  ): RerankedCandidate[] {
    if (candidates.length <= topK) return candidates;

    const selected: RerankedCandidate[] = [];
    const seenChunkIds = new Set<string>();
    const seenPages = new Map<number, number>();
    const seenSections = new Map<string, number>();
    const coveredFacets = new Set<string>();

    // Pass 1: Ensure top candidate for each unique facet or structural section
    const activeFacets = (facets || []).map(f => f.name);

    for (const facetName of activeFacets) {
      const match = candidates.find(c =>
        !seenChunkIds.has(c.chunkId) &&
        c.matchedFacets?.includes(facetName) &&
        c.finalScore >= 0.05
      );
      if (match) {
        selected.push(match);
        seenChunkIds.add(match.chunkId);
        coveredFacets.add(facetName);
        if (match.pageNumber) seenPages.set(match.pageNumber, (seenPages.get(match.pageNumber) || 0) + 1);
        if (match.sectionHeader) seenSections.set(match.sectionHeader, (seenSections.get(match.sectionHeader) || 0) + 1);
        if (selected.length >= topK) break;
      }
    }

    // Pass 2: Fill remaining slots by highest final score with section diversity penalty
    for (const cand of candidates) {
      if (selected.length >= topK) break;
      if (seenChunkIds.has(cand.chunkId)) continue;

      const pageCount = cand.pageNumber ? (seenPages.get(cand.pageNumber) || 0) : 0;
      // Prefer diverse pages unless pool is exhausted
      if (pageCount >= 2 && candidates.length > topK * 1.5) {
        continue;
      }

      selected.push(cand);
      seenChunkIds.add(cand.chunkId);
      if (cand.pageNumber) seenPages.set(cand.pageNumber, pageCount + 1);
    }

    // Pass 3: If still not at topK, fill unconditionally from remaining candidates
    if (selected.length < topK) {
      for (const cand of candidates) {
        if (selected.length >= topK) break;
        if (!seenChunkIds.has(cand.chunkId)) {
          selected.push(cand);
          seenChunkIds.add(cand.chunkId);
        }
      }
    }

    selected.sort((a, b) => {
      // Sort in document reading order (page/chunk sequence) for coherent grounded synthesis
      if (a.pageNumber !== undefined && b.pageNumber !== undefined && a.pageNumber !== b.pageNumber) {
        return a.pageNumber - b.pageNumber;
      }
      return b.finalScore - a.finalScore;
    });

    return selected;
  }

  /**
   * Grounding Gate: Evaluates candidate pool against conservative relevance criteria.
   * In document summary mode, evaluates cross-section grounding coverage across the document.
   * Strictly rejects queries with zero grounded evidence to prevent hallucinations.
   */
  public filterGroundedCandidates(
    query: string,
    candidates: RerankedCandidate[],
    options?: {
      minNeuralScore?: number;
      isSummaryMode?: boolean;
      intentAnalysis?: QueryIntentAnalysis;
      onDiagnostic?: (diag: RAGDiagnosticLog) => void;
    }
  ): RerankedCandidate[] {
    const isSummary = options?.isSummaryMode ?? false;
    const intentAnalysis = options?.intentAnalysis ?? this.detectQueryIntent(query);
    const sigKeywords = intentAnalysis.rawKeywords;
    const minNeuralScore = options?.minNeuralScore ?? (isSummary ? 0.25 : 0.40);

    let validCandidates: RerankedCandidate[] = [];
    let rejectionReason = '';
    let overallGroundingScore = 0;

    if (!candidates || candidates.length === 0) {
      rejectionReason = 'No candidate chunks retrieved from vector or keyword index';
    } else if (isSummary) {
      // --- SUMMARY / CROSS-SECTION GROUNDING GATE ---
      // 1. Verify candidates have substantive evidence for at least one structural facet or document content
      const facetCandidates = candidates.filter(cand => {
        const text = `${cand.title} ${cand.sectionHeader || ''} ${cand.content}`.toLowerCase();
        
        // If Neural Evaluated
        if (cand.isNeuralEvaluated) {
          return cand.neuralRerankScore >= minNeuralScore || (cand.vectorScore !== undefined && cand.vectorScore >= 0.60);
        }

        // Algorithmic facet / keyword verification
        const hasFacetMatch = (cand.matchedFacets && cand.matchedFacets.length > 0) || (cand.bestFacetScore && cand.bestFacetScore >= 0.20);
        const hasKeywordMatch = sigKeywords.some(kw => text.includes(kw));
        const hasStrongVector = cand.vectorScore !== undefined && cand.vectorScore >= 0.60;
        const hasRrfStrength = cand.rrfScore >= 0.008;

        return hasFacetMatch || hasKeywordMatch || hasStrongVector || hasRrfStrength;
      });

      // Count distinct structural facets or document sections covered
      const coveredFacets = new Set<string>();
      const coveredPages = new Set<number>();
      facetCandidates.forEach(c => {
        c.matchedFacets?.forEach(f => coveredFacets.add(f));
        if (c.pageNumber !== undefined) coveredPages.add(c.pageNumber);
      });

      // For summary queries, verify that the document contains genuine evidence
      // Check if user is asking for completely non-existent / hallucinatory topics
      const GENERIC_META_WORDS = new Set([
        'paper', 'papers', 'document', 'documents', 'study', 'studies', 'article', 'articles',
        'author', 'authors', 'summary', 'summarize', 'overview', 'entire', 'whole', 'all',
        'sections', 'section', 'explain', 'tell', 'outline', 'findings', 'results', 'result',
        'experiments', 'experiment', 'experimental', 'methodology', 'methods', 'method',
        'conclusion', 'conclusions', 'conclude', 'discussion', 'limitations', 'limitation',
        'work', 'sentence', 'sentences', 'please', 'main', 'major', 'key', 'core'
      ]);

      const specificTopicTerms = sigKeywords.filter(w => !GENERIC_META_WORDS.has(w));
      let specificTopicMatches = 0;
      if (specificTopicTerms.length > 0) {
        for (const term of specificTopicTerms) {
          const found = candidates.some(c =>
            c.content.toLowerCase().includes(term) ||
            (c.sectionHeader && c.sectionHeader.toLowerCase().includes(term)) ||
            (c.title && c.title.toLowerCase().includes(term))
          );
          if (found) specificTopicMatches++;
        }
      }

      const isCompletelyUnsupportedTopic = specificTopicTerms.length >= 2 && specificTopicMatches === 0;

      const hasDocumentEvidence = facetCandidates.length >= 2 || (facetCandidates.length >= 1 && coveredPages.size >= 1);

      if (isCompletelyUnsupportedTopic) {
        validCandidates = [];
        rejectionReason = `Requested subject topics (${specificTopicTerms.slice(0, 4).join(', ')}) not found in indexed document evidence`;
        overallGroundingScore = 0.05;
      } else if (hasDocumentEvidence) {
        validCandidates = facetCandidates;
        overallGroundingScore = Math.min(1.0, 0.5 + (coveredFacets.size * 0.1) + (facetCandidates.length * 0.05));
      } else {
        validCandidates = [];
        rejectionReason = 'Insufficient representative sections matched for document summary';
        overallGroundingScore = 0.2;
      }
    } else {
      // --- STANDARD FACTUAL HIGH-PRECISION GROUNDING GATE ---
      validCandidates = candidates.filter(cand => {
        if (cand.isNeuralEvaluated) {
          return cand.neuralRerankScore >= minNeuralScore;
        }

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

        if (sigKeywords.length === 1) {
          return matchedCount >= 1 && (
            (cand.vectorScore !== undefined && cand.vectorScore >= 0.65) ||
            (cand.keywordScore !== undefined && cand.keywordScore >= 0.20) ||
            cand.rrfScore > 0.012
          );
        }

        if (sigKeywords.length <= 3) {
          return (
            matchedCount >= 2 ||
            (matchedCount >= 1 && cand.vectorScore !== undefined && cand.vectorScore >= 0.70) ||
            (matchedCount >= 1 && cand.keywordScore !== undefined && cand.keywordScore >= 0.20) ||
            (matchedCount >= 1 && (cand.keywordRank === 1 || cand.vectorRank === 1))
          );
        }

        return matchedCount >= 2 && matchRatio >= 0.35;
      });

      if (validCandidates.length === 0) {
        rejectionReason = 'No candidate passed the conservative factual relevance threshold';
        overallGroundingScore = 0.15;
      } else {
        overallGroundingScore = Math.min(1.0, 0.6 + validCandidates.length * 0.1);
      }
    }

    const groundingStatus: 'GROUNDED' | 'INSUFFICIENT_EVIDENCE' = validCandidates.length > 0 ? 'GROUNDED' : 'INSUFFICIENT_EVIDENCE';

    // Structured RAG Diagnostic Internal Log (Safe: No passwords or keys)
    const diagnostic: RAGDiagnosticLog = {
      query,
      queryIntent: intentAnalysis.intent,
      isSummaryMode: isSummary,
      retrievedChunkIds: (candidates || []).map(c => c.chunkId),
      pageNumbers: (candidates || []).map(c => c.pageNumber || 0),
      similarityScores: (candidates || []).map(c => Math.round((c.vectorScore || 0) * 1000) / 1000),
      bm25Scores: (candidates || []).map(c => Math.round((c.keywordScore || 0) * 1000) / 1000),
      rrfScores: (candidates || []).map(c => Math.round(c.rrfScore * 10000) / 10000),
      rerankerScores: (candidates || []).map(c => Math.round((c.neuralRerankScore || 0) * 1000) / 1000),
      finalSelectedChunks: validCandidates.map(c => ({
        chunkId: c.chunkId,
        pageNumber: c.pageNumber,
        sectionHeader: c.sectionHeader,
        finalScore: Math.round(c.finalScore * 1000) / 1000,
        matchedFacets: c.matchedFacets,
      })),
      groundingScore: Math.round(overallGroundingScore * 100) / 100,
      groundingStatus,
      reason: validCandidates.length > 0 ? `Passed with ${validCandidates.length} grounded units` : rejectionReason,
      timestamp: new Date().toISOString(),
    };

    if (options?.onDiagnostic) {
      options.onDiagnostic(diagnostic);
    }

    return validCandidates;
  }
}

export const rerankService = new RerankService();
