/**
 * Server-side Types & Service Contracts
 */

import {
  Document,
  DocumentStatus,
  DocumentType,
  DocumentMetrics,
  Chunk,
  Collection,
  Conversation,
  Message,
  Citation,
  SearchResult,
  ProcessingJob,
  SecondBrainStats,
  QueryMetrics,
} from '../src/types';

export interface IngestionOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  collectionId?: string;
  tags?: string[];
  userId?: string;
}

export interface IngestionResult {
  documentId: string;
  chunksCreated: number;
  status: DocumentStatus;
  metrics?: DocumentMetrics;
}

export interface VectorSearchParams {
  vector: number[];
  limit: number;
  filter?: {
    documentId?: string;
    collectionId?: string;
    documentType?: DocumentType;
    userId?: string;
  };
}

export interface VectorSearchResult {
  chunkId: string;
  documentId: string;
  score: number;
  payload: {
    content: string;
    title: string;
    type: DocumentType;
    pageNumber?: number;
    slideNumber?: number;
    sectionHeader?: string;
    collectionId?: string;
    userId?: string;
  };
}

export interface KeywordSearchParams {
  query: string;
  limit: number;
  filter?: {
    documentId?: string;
    collectionId?: string;
    documentType?: DocumentType;
    userId?: string;
  };
}

export interface KeywordSearchResult {
  chunkId: string;
  documentId: string;
  score: number;
  content: string;
  title: string;
  type: DocumentType;
  pageNumber?: number;
  slideNumber?: number;
  sectionHeader?: string;
  userId?: string;
}

export interface HybridSearchParams {
  query: string;
  limit?: number;
  collectionId?: string;
  documentId?: string;
  userId?: string;
  vectorWeight?: number;
  keywordWeight?: number;
  rrfK?: number;
}

export interface GroundedContext {
  promptContext: string;
  citations: Citation[];
  chunks: Chunk[];
  tokenCount: number;
}

export interface ChatStreamEvent {
  type: 'chunk' | 'citations' | 'metrics' | 'done' | 'error';
  text?: string;
  citations?: Citation[];
  metrics?: Partial<QueryMetrics>;
  error?: string;
}
