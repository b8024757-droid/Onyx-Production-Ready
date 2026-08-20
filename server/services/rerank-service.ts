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
  | 'BROAD_MULTI_FACET'
  | 'FIGURE_SPECIFIC'
  | 'SECTION_SPECIFIC'
  | 'FACTUAL';

export interface SummaryFacet {
  name: string;
  label: string;
  terms: string[];
  subQuery: string;
  exactTerms?: string[];
  priority: number;
}

export interface QueryIntentAnalysis {
  intent: QueryIntent;
  isSummaryOrCrossSection: boolean;
  facets: SummaryFacet[];
  targetSections: string[];
  namedEntities: string[];
  rawKeywords: string[];
  exactPhrases: string[];
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
    isVisual?: boolean;
    figureId?: string;
  }>;
  supportedFacets?: string[];
  unsupportedFacets?: string[];
  pagesCovered?: number[];
  figuresDetected?: string[];
  groundingScore: number;
  groundingStatus: 'GROUNDED' | 'PARTIALLY_GROUNDED' | 'INSUFFICIENT_EVIDENCE';
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
  'including', 'includes', 'means', 'meaning', 'based', 'given', 'following', 'please', 'paper', 'document', 'study'
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
   * Extracts exact technical terms, acronyms, equations, and numbers.
   */
  public extractExactTechnicalTerms(query: string): string[] {
    if (!query) return [];
    const exactTerms: string[] = [];

    // Acronyms & uppercase terms (e.g. HMM, CRF, EEG, IMU, LOSO, SVM, AUC, ROC, L-BFGS)
    const acronyms = query.match(/\b([A-Z]{2,}(?:-[A-Za-z0-9]+)?)\b/g);
    if (acronyms) exactTerms.push(...acronyms);

    // Specific multi-word technical concepts
    const concepts = [
      'Naive Bayes', 'Conditional Random Field', 'Hidden Markov Model',
      'Bayesian inference', 'Butterworth filter', 'task-switch', 'task switch',
      'NeuroSky', 'MindBand', 'Empatica', 'Shimmer3', 'feature extraction',
      'spectral energy', 'mean error', 'standard deviation'
    ];
    for (const concept of concepts) {
      if (new RegExp(`\\b${concept}\\b`, 'i').test(query)) {
        exactTerms.push(concept);
      }
    }

    // Numbers with units or decimals (e.g. 0.35s, 27.02s, 0.25Hz, 50 Hz, 94.2%, 86.4%)
    const numbersWithUnits = query.match(/\b\d+(?:\.\d+)?\s*(?:s|sec|seconds|hz|mhz|ghz|%|percent|mw|fps|g|deg\/s)\b/gi);
    if (numbersWithUnits) exactTerms.push(...numbersWithUnits);

    // Figure and Table references (e.g. Figure 1, Fig. 2, Table 1)
    const figures = query.match(/\b(?:Figure|Fig\.?|Table)\s*\d+\b/gi);
    if (figures) exactTerms.push(...figures);

    return Array.from(new Set(exactTerms));
  }

  /**
   * Intelligently classifies the user query intent to determine whether
   * a high-coverage multi-section summary pipeline or high-precision factual pipeline is required.
   */
  public detectQueryIntent(query: string): QueryIntentAnalysis {
    const rawKeywords = this.extractSignificantKeywords(query);
    const exactPhrases = this.extractExactTechnicalTerms(query);
    const lower = query.toLowerCase();

    // Figure-specific query check
    const isFigureQuery = /\b(figure\s*\d+|fig\s*\d+|table\s*\d+|chart\s*\d+|graph\s*\d+|diagram\s*\d+|what does figure|show me figure|confusion matrix|roc curve)\b/i.test(query);

    // Structural domain definitions
    const domainIntro = /\b(intro|introduction|background|motivation|problem|objective|purpose|context|abstract|overview)\b/i;
    const domainMethod = /\b(method|methodology|approach|model|models|architecture|algorithm|algorithms|framework|technique|hmm|crf|markov|naive bayes|classifier|process|pipeline)\b/i;
    const domainExperiment = /\b(experiment|experiments|experimental|sensor|sensors|data|dataset|hardware|device|setup|subjects|participants|wearable|benchmark|protocol)\b/i;
    const domainProcessing = /\b(eeg|signal|filtering|filter|butterworth|artifact|preprocessing|feature|features|extraction|spectral)\b/i;
    const domainTaskSwitch = /\b(task-switch|task switch|transition|transitions|postural|state switching)\b/i;
    const domainResults = /\b(result|results|performance|accuracy|f1|precision|recall|metric|metrics|findings|evaluation|outcome|score|scores|comparison|numerical)\b/i;
    const domainFigures = /\b(figure|figures|fig|chart|charts|graph|graphs|table|tables|plot|plots|visual)\b/i;
    const domainBayesian = /\b(bayesian|bayes|prior|posterior|probability distribution|inference)\b/i;
    const domainLimitations = /\b(limitation|limitations|drawback|drawbacks|challenge|challenges|discussion|weakness|weaknesses|future work|constraint|constraints|caveat)\b/i;
    const domainRelated = /\b(related work|prior literature|previous studies|existing methods)\b/i;
    const domainConclusion = /\b(conclusion|conclusions|conclude|concluded|wrap up|summary|takeaways|takeaway|future potential|demonstrated)\b/i;

    const matchedDomains: string[] = [];
    if (domainIntro.test(query)) matchedDomains.push('intro');
    if (domainMethod.test(query)) matchedDomains.push('method');
    if (domainExperiment.test(query)) matchedDomains.push('experiment');
    if (domainProcessing.test(query)) matchedDomains.push('processing');
    if (domainTaskSwitch.test(query)) matchedDomains.push('task_switch');
    if (domainResults.test(query)) matchedDomains.push('results');
    if (domainFigures.test(query)) matchedDomains.push('figures');
    if (domainBayesian.test(query)) matchedDomains.push('bayesian');
    if (domainLimitations.test(query)) matchedDomains.push('limitations');
    if (domainRelated.test(query)) matchedDomains.push('related');
    if (domainConclusion.test(query)) matchedDomains.push('conclusion');

    // Whole-document summary indicators
    const isExplicitSummary = /\b(summarize|summary|overview|outline|entire paper|whole paper|entire document|whole document|all sections|synopsis|briefing|executive summary|main takeaways|core findings|what is this (paper|document) about|explain the paper|complete analysis|complete analytical analysis|comprehensive analysis|analyze the study|analyze this paper)\b/i.test(query);

    // Multi-topic query detection (e.g. comma-separated list of topics or 3+ domains)
    const commaClauseCount = (query.match(/,/g) || []).length;
    const isMultiClauseBroad = commaClauseCount >= 3 && matchedDomains.length >= 2;

    let intent: QueryIntent = 'FACTUAL';
    if (isExplicitSummary || matchedDomains.length >= 4) {
      intent = 'DOCUMENT_SUMMARY';
    } else if (isMultiClauseBroad || matchedDomains.length >= 3) {
      intent = 'BROAD_MULTI_FACET';
    } else if (isFigureQuery) {
      intent = 'FIGURE_SPECIFIC';
    } else if (matchedDomains.length >= 2) {
      intent = 'CROSS_SECTION';
    } else if (matchedDomains.length === 1 && !/\b(what is|who is|when did|where is|how many|which specific|calculate|define)\b/i.test(query)) {
      intent = 'SECTION_SPECIFIC';
    }

    const isSummaryOrCrossSection = intent === 'DOCUMENT_SUMMARY' || intent === 'BROAD_MULTI_FACET' || intent === 'CROSS_SECTION';
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
      namedEntities: Array.from(new Set([...technicalTerms, ...exactPhrases])),
      rawKeywords,
      exactPhrases,
    };
  }

  /**
   * Decomposes broad summary and multi-facet queries into targeted structural facets.
   */
  public decomposeSummaryFacets(
    query: string,
    intent: QueryIntent,
    matchedDomains: string[]
  ): SummaryFacet[] {
    const facets: SummaryFacet[] = [];
    const lower = query.toLowerCase();

    // 1. Universal Overview / Introduction / Motivation
    facets.push({
      name: 'overview',
      label: 'Introduction & Motivation',
      terms: ['abstract', 'introduction', 'background', 'motivation', 'problem', 'purpose', 'overview'],
      subQuery: 'problem statement motivation background overview introduction',
      exactTerms: ['introduction', 'background', 'motivation'],
      priority: 1,
    });

    // 2. Universal Experimental Setup & Hardware / Sensors
    const expTerms = ['experiment', 'experimental', 'dataset', 'data', 'evaluation', 'setup', 'participant', 'participants', 'subject', 'subjects', 'volunteer', 'volunteers', 'protocol'];
    const sensorTerms = ['sensor', 'sensors', 'hardware', 'device', 'wearable', 'placement', 'imu', 'accelerometer', 'gyroscope', 'neurosky', 'mindband', 'empatica', 'e3', 'shimmer3'];
    facets.push({
      name: 'experiment_sensors',
      label: 'Experiment, Participants & Sensor Setup',
      terms: [...expTerms, ...sensorTerms],
      subQuery: 'experimental setup participants subjects sensor hardware placement wearable devices NeuroSky Empatica Shimmer3 IMU accelerometer gyroscope',
      exactTerms: ['participants', 'subjects', 'sensors', 'hardware', 'IMU', 'accelerometer', 'gyroscope'],
      priority: 2,
    });

    // 3. Universal Sequential Models & Methodology (HMM, CRF, algorithms)
    const modelTerms = ['methodology', 'method', 'approach', 'model', 'algorithm', 'architecture', 'hmm', 'markov', 'crf', 'conditional random field', 'naive bayes', 'generative', 'discriminative', 'state transition', 'emission', 'baum-welch', 'viterbi', 'l-bfgs', 'formulation', 'mathematical'];
    facets.push({
      name: 'models_hmm_crf',
      label: 'HMM & CRF Models & Methodology',
      terms: modelTerms,
      subQuery: 'Hidden Markov Model HMM Conditional Random Field CRF generative discriminative model state transitions methodology mathematical formulation',
      exactTerms: ['HMM', 'Hidden Markov Model', 'CRF', 'Conditional Random Field', 'generative', 'discriminative'],
      priority: 3,
    });

    // 4. Universal Major Results & Metrics
    facets.push({
      name: 'results_metrics',
      label: 'Numerical Results & Evaluation Metrics',
      terms: ['results', 'performance', 'accuracy', 'metrics', 'findings', 'comparison', 'evaluation', 'f1', 'precision', 'recall', 'mean error', 'standard deviation', 'table'],
      subQuery: 'major results numerical accuracy F1 precision recall mean error standard deviation statistical performance comparison Table',
      exactTerms: ['accuracy', 'F1', 'mean error', 'standard deviation', 'results', 'Table'],
      priority: 4,
    });

    // 5. Universal Limitations & Discussion
    facets.push({
      name: 'limitations_discussion',
      label: 'Limitations & Discussion',
      terms: ['limitations', 'challenges', 'discussion', 'weaknesses', 'drawbacks', 'trade-offs', 'constraints', 'battery', 'energy', 'hardware'],
      subQuery: 'limitations challenges weaknesses drawbacks trade-offs constraints discussion battery energy',
      exactTerms: ['limitations', 'challenges', 'weaknesses', 'drawbacks'],
      priority: 5,
    });

    // 6. Universal Conclusion & Future Work
    facets.push({
      name: 'conclusion_future_work',
      label: 'Conclusion & Future Potential',
      terms: ['conclusion', 'conclusions', 'summary', 'future work', 'key takeaways', 'concluding', 'future potential', 'demonstrated', 'implications'],
      subQuery: 'conclusion future work future potential key takeaways experimental demonstration summary',
      exactTerms: ['conclusion', 'future work', 'future potential'],
      priority: 6,
    });

    // Specialized / Domain-conditional facets (activated if query or domain mentions them)
    if (/\b(eeg|signal|brain|neuro|filtering|butterworth|artifact|preprocessing|feature extraction|spectral)\b/i.test(query)) {
      facets.push({
        name: 'eeg_feature_extraction',
        label: 'EEG Data Processing & Feature Extraction',
        terms: ['eeg', 'signal', 'processing', 'filter', 'filtering', 'butterworth', 'artifact', 'sampling', 'feature', 'features', 'extraction', 'spectral', 'energy', 'frequency', 'time-domain', 'sma'],
        subQuery: 'EEG data processing signal filtering Butterworth artifact removal feature extraction spectral energy time domain frequency',
        exactTerms: ['EEG', 'processing', 'filtering', 'Butterworth', 'feature extraction', 'spectral energy'],
        priority: 2.5,
      });
    }

    if (/\b(task-switch|task switch|transition|transitions|postural|switching|state sequence)\b/i.test(query)) {
      facets.push({
        name: 'task_switch_detection',
        label: 'Task-Switch Detection & Transition Dynamics',
        terms: ['task-switch', 'task switch', 'transition', 'transitions', 'dynamic', 'postural', 'switching', 'detection', 'state sequence'],
        subQuery: 'task-switch detection methodology transition dynamics state switching postural transitions dynamic activities',
        exactTerms: ['task-switch', 'task switch', 'transition', 'transitions'],
        priority: 3.5,
      });
    }

    if (/\b(figure|figures|fig|chart|charts|graph|graphs|plot|plots|roc|confusion matrix|curve|diagram)\b/i.test(query)) {
      facets.push({
        name: 'figures_visuals',
        label: 'Figures, Charts & Visual Evidence',
        terms: ['figure', 'figures', 'fig', 'chart', 'charts', 'graph', 'graphs', 'plot', 'plots', 'roc', 'confusion matrix', 'curve', 'diagram'],
        subQuery: 'Figure 1 Figure 2 Figure 3 Figure 4 confusion matrix ROC curve charts graphs visual results plots',
        exactTerms: ['Figure', 'Fig', 'Figure 1', 'Figure 2', 'Figure 3', 'Figure 4', 'confusion matrix', 'ROC curve'],
        priority: 3.8,
      });
    }

    if (/\b(bayesian|bayes|prior|posterior|probability distribution|inference)\b/i.test(query)) {
      facets.push({
        name: 'bayesian_inference',
        label: 'Bayesian Inference & Probability Distribution',
        terms: ['bayesian', 'bayes', 'prior', 'posterior', 'likelihood', 'inference', 'probability', 'distribution', 'update'],
        subQuery: 'Bayesian inference prior posterior probability distribution likelihood updates statistical modeling',
        exactTerms: ['Bayesian inference', 'Bayesian', 'posterior', 'prior'],
        priority: 4.5,
      });
    }

    if (/\b(related work|prior literature|previous studies|existing methods)\b/i.test(query)) {
      facets.push({
        name: 'related_work',
        label: 'Related Work & Prior Studies',
        terms: ['related work', 'prior literature', 'previous studies', 'existing methods', 'literature review'],
        subQuery: 'related work prior literature previous studies existing methods baseline comparison',
        exactTerms: ['related work', 'prior studies'],
        priority: 5.5,
      });
    }

    // Boost priority of facets matching terms in the query
    facets.forEach(f => {
      const matchCount = f.terms.filter(t => lower.includes(t.toLowerCase())).length;
      if (matchCount > 0) {
        f.priority -= matchCount * 0.8;
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

    return candidates.slice(0, Math.max(topN * 3, 50));
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
      return this.balanceCandidatesAcrossSections(candidates, topK, options?.facets);
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
          .slice(0, 30)
          .map((c, i) => `[PASSAGE ${i + 1}] (Section: ${c.sectionHeader || 'General'}, Page: ${c.pageNumber || 1}${c.isVisual ? ' | VISUAL FIGURE' : ''})\n${c.content.slice(0, 350)}`)
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
    const exactTerms = this.extractExactTechnicalTerms(query);
    const isMathOrMethodQuery = /\b(formulation|mathematical|formula|equation|feature extraction|features|algorithm|loss function|probability)\b/i.test(query);

    candidates.forEach(c => {
      const text = `${c.title} ${c.sectionHeader || ''} ${c.content}`.toLowerCase();
      let matchCount = 0;
      for (const w of sigKeywords) {
        if (text.includes(w)) matchCount++;
      }

      let exactMatchCount = 0;
      for (const term of exactTerms) {
        if (text.includes(term.toLowerCase())) exactMatchCount += 2;
      }

      // Section header keyword match boost
      let headerBoost = 0;
      if (c.sectionHeader) {
        const hText = c.sectionHeader.toLowerCase();
        for (const w of sigKeywords) {
          if (hText.includes(w)) headerBoost += 0.15;
        }
      }

      // Mathematical formulation boost for math/methodology queries
      let mathBoost = 0;
      if (isMathOrMethodQuery) {
        if (/p\(|sum_|prod\(|exp\(|z\(x\)|\bl-bfgs\b|\bbaum-welch\b|\bgaussian\b|\bfeature extraction\b|\btime-domain\b/i.test(c.content)) {
          mathBoost = 0.35;
        }
      }

      const totalTerms = Math.max(1, sigKeywords.length + exactTerms.length * 2);
      const matchRatio = Math.min(1.0, (matchCount + exactMatchCount) / totalTerms + headerBoost + mathBoost);
      
      const bestFacetScore = c.bestFacetScore || 0;
      const combinedAlgorithmic = isSummary
        ? Math.max(bestFacetScore * 0.7, matchRatio * 0.5)
        : matchRatio;

      c.neuralRerankScore = combinedAlgorithmic;
      c.isNeuralEvaluated = false;
      c.finalScore = c.rrfScore * 0.3 + combinedAlgorithmic * 0.7;
    });

    candidates.sort((a, b) => b.finalScore - a.finalScore);
    return this.balanceCandidatesAcrossSections(candidates, topK, options?.facets);
  }

  /**
   * Tags candidate chunks with the structural facets they satisfy.
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
          const fScore = Math.min(1.0, (facetMatches / Math.max(2, f.terms.length * 0.4)) + 0.2);
          if (fScore > bestScore) bestScore = fScore;
        }
      }

      // Also check page / section position heuristics if sectionHeader is missing
      if (cand.pageNumber !== undefined) {
        if (cand.pageNumber <= 2 && !matched.includes('overview')) matched.push('overview');
      }

      if (cand.isVisual) {
        matched.push('figures_visuals');
        bestScore = Math.max(bestScore, 0.85);
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
    if (candidates.length <= topK) {
      return [...candidates].sort((a, b) => {
        if (a.pageNumber !== undefined && b.pageNumber !== undefined && a.pageNumber !== b.pageNumber) {
          return a.pageNumber - b.pageNumber;
        }
        return b.finalScore - a.finalScore;
      });
    }

    const selected: RerankedCandidate[] = [];
    const seenChunkIds = new Set<string>();
    const seenPages = new Map<number, number>();
    const seenSections = new Map<string, number>();
    const coveredFacets = new Set<string>();

    // Pass 0: Always preserve top direct relevance candidates (top 4)
    const sortedByScore = [...candidates].sort((a, b) => b.finalScore - a.finalScore);
    for (let i = 0; i < Math.min(4, sortedByScore.length); i++) {
      const cand = sortedByScore[i];
      if (cand && cand.finalScore > 0.02) {
        selected.push(cand);
        seenChunkIds.add(cand.chunkId);
        cand.matchedFacets?.forEach(f => coveredFacets.add(f));
        if (cand.pageNumber) seenPages.set(cand.pageNumber, (seenPages.get(cand.pageNumber) || 0) + 1);
        if (cand.sectionHeader) seenSections.set(cand.sectionHeader, (seenSections.get(cand.sectionHeader) || 0) + 1);
      }
    }

    // Pass 1: Ensure candidate for each remaining unique facet or structural section
    const activeFacets = (facets || []).map(f => f.name);

    for (const facetName of activeFacets) {
      if (selected.length >= topK) break;
      if (coveredFacets.has(facetName)) continue;
      const match = candidates.find(c =>
        !seenChunkIds.has(c.chunkId) &&
        c.matchedFacets?.includes(facetName) &&
        c.finalScore >= 0.02
      );
      if (match) {
        selected.push(match);
        seenChunkIds.add(match.chunkId);
        coveredFacets.add(facetName);
        if (match.pageNumber) seenPages.set(match.pageNumber, (seenPages.get(match.pageNumber) || 0) + 1);
        if (match.sectionHeader) seenSections.set(match.sectionHeader, (seenSections.get(match.sectionHeader) || 0) + 1);
      }
    }

    // Pass 2: Ensure representation from distinct pages across the whole document (pages 1..N)
    const allPages = Array.from(new Set(candidates.map(c => c.pageNumber).filter((p): p is number => p !== undefined))).sort((a, b) => a - b);
    for (const page of allPages) {
      if (selected.length >= topK) break;
      if (!seenPages.has(page) || seenPages.get(page) === 0) {
        const pageCandidate = candidates.find(c => !seenChunkIds.has(c.chunkId) && c.pageNumber === page && c.finalScore >= 0.02);
        if (pageCandidate) {
          selected.push(pageCandidate);
          seenChunkIds.add(pageCandidate.chunkId);
          seenPages.set(page, (seenPages.get(page) || 0) + 1);
          pageCandidate.matchedFacets?.forEach(f => coveredFacets.add(f));
        }
      }
    }

    // Pass 3: Preserve visual chunks (figures, charts)
    for (const cand of candidates) {
      if (selected.length >= topK) break;
      if (cand.isVisual && !seenChunkIds.has(cand.chunkId)) {
        selected.push(cand);
        seenChunkIds.add(cand.chunkId);
      }
    }

    // Pass 4: Fill remaining slots by highest final score with section diversity penalty
    for (const cand of candidates) {
      if (selected.length >= topK) break;
      if (seenChunkIds.has(cand.chunkId)) continue;

      const pageCount = cand.pageNumber ? (seenPages.get(cand.pageNumber) || 0) : 0;
      if (pageCount >= 3 && candidates.length > topK * 1.2) {
        continue;
      }

      selected.push(cand);
      seenChunkIds.add(cand.chunkId);
      if (cand.pageNumber) seenPages.set(cand.pageNumber, pageCount + 1);
    }

    // Pass 5: If still not at topK, fill unconditionally from remaining candidates
    if (selected.length < topK) {
      for (const cand of candidates) {
        if (selected.length >= topK) break;
        if (!seenChunkIds.has(cand.chunkId)) {
          selected.push(cand);
          seenChunkIds.add(cand.chunkId);
        }
      }
    }

    // Sort in document reading order (page/chunk sequence) for coherent grounded synthesis
    selected.sort((a, b) => {
      if (a.pageNumber !== undefined && b.pageNumber !== undefined && a.pageNumber !== b.pageNumber) {
        return a.pageNumber - b.pageNumber;
      }
      return b.finalScore - a.finalScore;
    });

    return selected;
  }

  /**
   * Grounding Gate: Evaluates candidate pool against conservative relevance criteria.
   * Evaluates groundedness facet by facet with partial evidence handling and 2-stage verification.
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
    const minNeuralScore = options?.minNeuralScore ?? (isSummary ? 0.20 : 0.40);

    let validCandidates: RerankedCandidate[] = [];
    let rejectionReason = '';
    let overallGroundingScore = 0;
    const supportedFacets: string[] = [];
    const unsupportedFacets: string[] = [];
    const figuresDetected: string[] = [];

    if (!candidates || candidates.length === 0) {
      rejectionReason = 'No candidate chunks retrieved from vector or keyword index';
    } else if (isSummary) {
      // --- SUMMARY / MULTI-FACET GROUNDING GATE ---
      const activeFacets = intentAnalysis.facets;

      const facetCandidates = candidates.filter(cand => {
        const text = `${cand.title} ${cand.sectionHeader || ''} ${cand.content}`.toLowerCase();
        
        if (cand.isVisual) {
          if (cand.figureId) figuresDetected.push(cand.figureId);
          return true;
        }

        // If Neural Evaluated
        if (cand.isNeuralEvaluated) {
          return cand.neuralRerankScore >= minNeuralScore || (cand.vectorScore !== undefined && cand.vectorScore >= 0.55);
        }

        // Algorithmic facet / keyword verification
        const hasFacetMatch = (cand.matchedFacets && cand.matchedFacets.length > 0) || (cand.bestFacetScore && cand.bestFacetScore >= 0.15);
        const hasKeywordMatch = sigKeywords.some(kw => text.includes(kw));
        const hasStrongVector = cand.vectorScore !== undefined && cand.vectorScore >= 0.55;
        const hasRrfStrength = cand.rrfScore >= 0.005;

        return hasFacetMatch || hasKeywordMatch || hasStrongVector || hasRrfStrength;
      });

      // Evaluate grounded coverage per facet
      for (const facet of activeFacets) {
        const hasMatch = facetCandidates.some(c => {
          if (c.matchedFacets?.includes(facet.name)) return true;
          const text = `${c.title} ${c.sectionHeader || ''} ${c.content}`.toLowerCase();
          return facet.terms.some(t => text.includes(t.toLowerCase()));
        });
        if (hasMatch) {
          supportedFacets.push(facet.name);
        } else {
          unsupportedFacets.push(facet.name);
        }
      }

      // Check if user is asking for completely non-existent / hallucinatory topics
      const GENERIC_META_WORDS = new Set([
        'paper', 'papers', 'document', 'documents', 'study', 'studies', 'article', 'articles',
        'author', 'authors', 'summary', 'summarize', 'overview', 'entire', 'whole', 'all',
        'sections', 'section', 'explain', 'tell', 'outline', 'findings', 'results', 'result',
        'experiments', 'experiment', 'experimental', 'methodology', 'methods', 'method',
        'conclusion', 'conclusions', 'conclude', 'discussion', 'limitations', 'limitation',
        'work', 'sentence', 'sentences', 'please', 'main', 'major', 'key', 'core',
        'objective', 'objectives', 'purpose', 'covering', 'cover', 'aspects', 'details', 'points', 'bullet', 'bullets'
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
      const hasDocumentEvidence = facetCandidates.length >= 1;

      if (isCompletelyUnsupportedTopic) {
        validCandidates = [];
        rejectionReason = `Requested subject topics (${specificTopicTerms.slice(0, 4).join(', ')}) not found in indexed document evidence`;
        overallGroundingScore = 0.0;
      } else if (hasDocumentEvidence) {
        validCandidates = facetCandidates;
        overallGroundingScore = Math.min(1.0, 0.4 + (supportedFacets.length * 0.08) + (facetCandidates.length * 0.02));
      } else {
        validCandidates = [];
        rejectionReason = 'Insufficient representative sections matched for document summary';
        overallGroundingScore = 0.2;
      }
    } else {
      // --- STANDARD FACTUAL HIGH-PRECISION GROUNDING GATE ---
      validCandidates = candidates.filter(cand => {
        if (cand.isVisual) {
          if (cand.figureId) figuresDetected.push(cand.figureId);
          return true;
        }

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
            (cand.vectorScore !== undefined && cand.vectorScore >= 0.60) ||
            (cand.keywordScore !== undefined && cand.keywordScore >= 0.15) ||
            cand.rrfScore > 0.010
          );
        }

        if (sigKeywords.length <= 3) {
          return (
            matchedCount >= 2 ||
            (matchedCount >= 1 && cand.vectorScore !== undefined && cand.vectorScore >= 0.65) ||
            (matchedCount >= 1 && cand.keywordScore !== undefined && cand.keywordScore >= 0.15) ||
            (matchedCount >= 1 && (cand.keywordRank === 1 || cand.vectorRank === 1))
          );
        }

        return matchedCount >= 2 || matchRatio >= 0.30;
      });

      if (validCandidates.length === 0) {
        rejectionReason = 'No candidate passed the conservative factual relevance threshold';
        overallGroundingScore = 0.15;
      } else {
        overallGroundingScore = Math.min(1.0, 0.6 + validCandidates.length * 0.1);
      }
    }

    const pagesCovered = Array.from(new Set(validCandidates.map(c => c.pageNumber).filter((p): p is number => p !== undefined))).sort((a, b) => a - b);

    let groundingStatus: 'GROUNDED' | 'PARTIALLY_GROUNDED' | 'INSUFFICIENT_EVIDENCE' = 'INSUFFICIENT_EVIDENCE';
    if (validCandidates.length > 0) {
      if (unsupportedFacets.length > 0 && supportedFacets.length > 0 && unsupportedFacets.length > supportedFacets.length) {
        groundingStatus = 'PARTIALLY_GROUNDED';
      } else {
        groundingStatus = 'GROUNDED';
      }
    }

    // Structured RAG Diagnostic Internal Log
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
        isVisual: c.isVisual,
        figureId: c.figureId,
      })),
      supportedFacets,
      unsupportedFacets,
      pagesCovered,
      figuresDetected: Array.from(new Set(figuresDetected)),
      groundingScore: Math.round(overallGroundingScore * 100) / 100,
      groundingStatus,
      reason: validCandidates.length > 0 ? `Passed with ${validCandidates.length} grounded units across pages [${pagesCovered.join(', ')}]` : rejectionReason,
      timestamp: new Date().toISOString(),
    };

    if (options?.onDiagnostic) {
      options.onDiagnostic(diagnostic);
    }

    return validCandidates;
  }
}

export const rerankService = new RerankService();

