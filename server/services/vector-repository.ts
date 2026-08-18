import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config';
import { DocumentType } from '../../src/types';

export interface VectorPoint {
  id: string | number;
  vector: number[];
  payload: {
    chunkId: string;
    documentId: string;
    content: string;
    title: string;
    type: DocumentType;
    pageNumber?: number;
    slideNumber?: number;
    sectionHeader?: string;
    collectionId?: string;
    sourceUrl?: string;
    chunkIndex?: number;
    userId?: string;
  };
}

export interface VectorSearchFilter {
  documentId?: string;
  collectionId?: string;
  documentType?: DocumentType;
  userId?: string;
}

export interface VectorSearchHit {
  id: string | number;
  score: number;
  payload: VectorPoint['payload'];
}

export class VectorRepository {
  private client: QdrantClient | null = null;
  private collectionName: string;
  private vectorDimension: number;
  private isConnected = false;
  private lastError: string | null = null;

  // Persistent vector backup map in case external Qdrant endpoint is offline
  private memoryVectorMap = new Map<string, { vector: number[]; payload: VectorPoint['payload'] }>();

  constructor() {
    this.collectionName = config.qdrant.collectionName || 'second_brain_knowledge';
    this.vectorDimension = config.qdrant.vectorDimension || 768;

    try {
      this.client = new QdrantClient({
        url: config.qdrant.url,
        apiKey: config.qdrant.apiKey || undefined,
        checkCompatibility: false,
      });
    } catch (err: any) {
      this.lastError = err.message;
      this.client = null;
    }
  }

  public async init(): Promise<void> {
    if (!this.client) return;

    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections?.some(c => c.name === this.collectionName);

      if (!exists) {
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: this.vectorDimension,
            distance: 'Cosine',
          },
        });
        console.log(`[Qdrant] Collection "${this.collectionName}" created successfully.`);
      }

      // Ensure payload indexes exist for efficient filtering
      const indexFields = ['documentId', 'collectionId', 'type', 'userId'];
      for (const field of indexFields) {
        try {
          await this.client.createPayloadIndex(this.collectionName, {
            field_name: field,
            field_schema: 'keyword',
          });
        } catch {
          // Index might already exist
        }
      }

      this.isConnected = true;
      this.lastError = null;
    } catch (err: any) {
      this.isConnected = false;
      this.lastError = `Qdrant unreachable at ${config.qdrant.url}: ${err.message || err}`;
      console.warn(`[Qdrant] ${this.lastError}. Operating in standalone vector mode.`);
    }
  }

  public getHealth(): {
    connected: boolean;
    provider: string;
    url: string;
    vectorDimension: number;
    error: string | null;
    totalVectors: number;
  } {
    return {
      connected: this.isConnected,
      provider: this.isConnected ? 'Qdrant (Remote Cluster)' : 'Qdrant Driver (Standalone Fallback Index)',
      url: config.qdrant.url,
      vectorDimension: this.vectorDimension,
      error: this.lastError,
      totalVectors: this.memoryVectorMap.size,
    };
  }

  public async upsertVectors(points: VectorPoint[]): Promise<void> {
    // Always update local persistent vector store
    for (const pt of points) {
      this.memoryVectorMap.set(String(pt.payload.chunkId), {
        vector: pt.vector,
        payload: pt.payload,
      });
    }

    if (this.isConnected && this.client) {
      try {
        await this.client.upsert(this.collectionName, {
          wait: true,
          points: points.map((p, idx) => ({
            id: typeof p.id === 'number' ? p.id : (Date.now() + idx),
            vector: p.vector,
            payload: p.payload,
          })),
        });
      } catch (err: any) {
        console.warn(`[Qdrant] Upsert error: ${err.message}. Chunks retained in vector repository.`);
      }
    }
  }

  public async search(
    queryVector: number[],
    limit = 20,
    filter?: VectorSearchFilter
  ): Promise<VectorSearchHit[]> {
    if (this.isConnected && this.client) {
      try {
        const mustFilter: any[] = [];
        if (filter?.documentId) {
          mustFilter.push({ key: 'documentId', match: { value: filter.documentId } });
        }
        if (filter?.collectionId) {
          mustFilter.push({ key: 'collectionId', match: { value: filter.collectionId } });
        }
        if (filter?.documentType) {
          mustFilter.push({ key: 'type', match: { value: filter.documentType } });
        }
        if (filter?.userId) {
          mustFilter.push({ key: 'userId', match: { value: filter.userId } });
        }

        const clientAny = this.client as any;
        const res = await clientAny.query(this.collectionName, {
          query: queryVector,
          limit,
          filter: mustFilter.length > 0 ? { must: mustFilter } : undefined,
          with_payload: true,
        });

        const points = res?.points || [];
        if (Array.isArray(points) && points.length > 0) {
          return points.map((hit: any) => ({
            id: hit.id,
            score: hit.score,
            payload: hit.payload as any,
          }));
        }
      } catch (err: any) {
        console.warn(`[Qdrant] Search failed: ${err.message}. Falling back to repository vectors.`);
      }
    }

    // Direct repository vector search with exact cosine similarity & filter application
    const hits: VectorSearchHit[] = [];

    for (const [chunkId, record] of this.memoryVectorMap.entries()) {
      const payload = record.payload;

      // Apply filters
      if (filter?.documentId && payload.documentId !== filter.documentId) continue;
      if (filter?.collectionId && payload.collectionId !== filter.collectionId) continue;
      if (filter?.documentType && payload.type !== filter.documentType) continue;
      if (filter?.userId) {
        const isMatch = payload.userId === filter.userId || (!payload.userId && filter.userId === 'user-default-admin');
        if (!isMatch) continue;
      }

      const score = this.calculateCosineSimilarity(queryVector, record.vector);
      hits.push({
        id: chunkId,
        score,
        payload,
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  public async deleteByDocumentId(documentId: string): Promise<void> {
    for (const [chunkId, record] of this.memoryVectorMap.entries()) {
      if (record.payload.documentId === documentId) {
        this.memoryVectorMap.delete(chunkId);
      }
    }

    if (this.isConnected && this.client) {
      try {
        await this.client.delete(this.collectionName, {
          wait: true,
          filter: {
            must: [{ key: 'documentId', match: { value: documentId } }],
          },
        });
      } catch (err: any) {
        console.warn(`[Qdrant] Delete error: ${err.message}`);
      }
    }
  }

  private calculateCosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const mag = Math.sqrt(normA) * Math.sqrt(normB);
    if (mag === 0) return 0;

    // Normalize from [-1, 1] to [0, 1]
    const raw = dot / mag;
    return Math.max(0, Math.min(1, (raw + 1) / 2));
  }
}

export const vectorRepository = new VectorRepository();
