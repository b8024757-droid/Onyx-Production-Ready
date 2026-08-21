/**
 * Second Brain — Server Configuration & Environment Management
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    textModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2-preview',
    embeddingDimension: 768,
  },
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY || '',
    collectionName: 'second_brain_knowledge',
    vectorDimension: 768,
  },
  postgres: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/second_brain',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/second_brain',
  },
  rag: {
    defaultChunkSize: 500, // characters
    defaultChunkOverlap: 50,
    topKCandidates: 20,
    topKReranked: 6,
    rrfConstantK: 60,
  },
  upload: {
    maxFileSizeMb: 500,
    chunkSizeMb: parseInt(process.env.UPLOAD_CHUNK_SIZE_MB || '5', 10),
    sessionTtlMinutes: parseInt(process.env.UPLOAD_SESSION_TTL_MINUTES || '60', 10),
    get maxFileSizeBytes(): number {
      return this.maxFileSizeMb * 1024 * 1024;
    },
    get chunkSizeBytes(): number {
      return this.chunkSizeMb * 1024 * 1024;
    },
  },
};
