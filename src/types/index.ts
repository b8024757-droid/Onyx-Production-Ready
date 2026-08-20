/**
 * Second Brain — Core TypeScript Data Models & Contracts
 */

export type DocumentType =
  | 'PDF'
  | 'DOC'
  | 'DOCX'
  | 'PPT'
  | 'PPTX'
  | 'TXT'
  | 'MD'
  | 'CSV'
  | 'XLS'
  | 'XLSX'
  | 'HTML'
  | 'URL'
  | 'IMAGE'
  | 'MULTIPLE_FILES';

export type DocumentCategory =
  | 'All'
  | 'Documents'
  | 'Presentations'
  | 'Notes'
  | 'Web'
  | 'Images';

export type DocumentStatus =
  | 'UPLOADING'
  | 'PARSING'
  | 'PROCESSING'
  | 'CHUNKING'
  | 'EMBEDDING'
  | 'INDEXING'
  | 'READY'
  | 'FAILED';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  createdAt: string;
}

export interface SetupStatus {
  userId: string;
  geminiConnected: boolean;
  geminiMasked?: string;
  qdrantConnected: boolean;
  qdrantUrlMasked?: string;
  postgresConnected: boolean;
  postgresUrlMasked?: string;
  setupCompleted: boolean;
  currentSetupStep: 'gemini' | 'qdrant' | 'postgres' | 'ready' | 'completed';
}

export interface Tag {
  id: string;
  name: string;
  color?: string;
}

export interface Collection {
  id: string;
  userId?: string;
  name: string;
  description?: string;
  documentCount: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Chunk {
  id: string;
  userId?: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber?: number;
  slideNumber?: number;
  sectionHeader?: string;
  metadata?: Record<string, any>;
  embedding?: number[];
}

export interface DocumentMetrics {
  parsingTimeMs?: number;
  chunkingTimeMs?: number;
  visualExtractionTimeMs?: number;
  embeddingTimeMs?: number;
  qdrantTimeMs?: number;
  bm25TimeMs?: number;
  databaseTimeMs?: number;
  totalTimeMs?: number;
  embeddingCalls?: number;
  embeddingBatchSize?: number;
  qdrantBatchSize?: number;
  charCount?: number;
  deduplicated?: boolean;
}

export interface Document {
  id: string;
  userId?: string;
  title: string;
  originalName: string;
  type: DocumentType;
  category: DocumentCategory;
  collectionId?: string;
  collectionName?: string;
  contentHash?: string;
  status: DocumentStatus;
  progress: number; // 0 to 100
  statusMessage?: string;
  sizeBytes: number;
  pageCount?: number;
  slideCount?: number;
  sectionCount?: number;
  chunkCount?: number;
  sourceUrl?: string;
  tags: string[];
  summary?: string;
  author?: string;
  storagePath?: string;
  createdAt: string;
  updatedAt: string;
  contentPreview?: string;
  metrics?: DocumentMetrics;
}

export interface Citation {
  id: string;
  citationIndex: number; // 1, 2, 3...
  documentId: string;
  documentTitle: string;
  sourceType: DocumentType;
  pageNumber?: number;
  slideNumber?: number;
  section?: string;
  chunkId: string;
  excerpt: string;
  sourceUrl?: string;
  collectionName?: string;
  addedDate?: string;
  score?: number;
  isVisual?: boolean;
  visualType?: string;
  figureId?: string;
  figureTitle?: string;
  axes?: { x?: string; y?: string };
  legend?: string[];
  trendSummary?: string;
  keyValues?: string[];
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: Citation[];
  createdAt: string;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  userId?: string;
  title: string;
  lastMessagePreview?: string;
  messageCount: number;
  collectionScopeId?: string; // Optional collection filter
  tags?: string[];
  sourcesReferenced?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResult {
  id: string;
  documentId: string;
  documentTitle: string;
  documentType: DocumentType;
  collectionName?: string;
  chunkId: string;
  content: string;
  score: number;
  vectorScore?: number;
  keywordScore?: number;
  pageNumber?: number;
  slideNumber?: number;
  sectionHeader?: string;
  highlight?: string;
}

export interface ProcessingJob {
  id: string;
  userId?: string;
  documentId: string;
  fileName: string;
  fileType: DocumentType;
  fileSizeBytes: number;
  status: DocumentStatus;
  progress: number;
  stepMessage: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  chunkCount?: number;
  pageCount?: number;
  visualElementCount?: number;
  metrics?: DocumentMetrics;
}

export interface AppNotification {
  id: string;
  userId?: string;
  type: 'SUCCESS' | 'INFO' | 'ERROR';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  documentId?: string;
  collectionId?: string;
  linkTab?: string;
}

export interface ActivityItem {
  id: string;
  userId?: string;
  type: 'index_complete' | 'search' | 'source_added' | 'collection_created';
  title: string;
  description: string;
  timestamp: string;
  documentId?: string;
  query?: string;
}

export interface SecondBrainStats {
  sourcesCount: number;
  collectionsCount: number;
  unitsCount: number; // chunks / knowledge atoms
  indexedPercentage: number;
  recentActivity: ActivityItem[];
}

export interface QueryMetrics {
  queryProcessingTimeMs: number;
  vectorSearchLatencyMs: number;
  bm25LatencyMs: number;
  rrfLatencyMs: number;
  rerankLatencyMs: number;
  contextBuildingLatencyMs: number;
  timeToFirstTokenMs: number;
  llmGenerationLatencyMs: number;
  totalQueryLatencyMs: number;
  vectorUnavailable?: boolean;
  groundingPassed?: boolean;
  groundingStatus?: 'GROUNDED' | 'INSUFFICIENT_EVIDENCE';
}
