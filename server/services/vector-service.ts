import { embeddingService } from './embedding-service';
import { vectorRepository, VectorPoint, VectorSearchFilter } from './vector-repository';
import { VectorSearchParams, VectorSearchResult } from '../types';

export class VectorService {
  public async init(): Promise<void> {
    await vectorRepository.init();
  }

  public async getEmbedding(text: string, options?: { isQuery?: boolean }): Promise<number[]> {
    if (options?.isQuery) {
      return embeddingService.embedQuery(text);
    }
    return embeddingService.embedText(text);
  }

  public async upsertChunkVectors(points: VectorPoint[]): Promise<void> {
    await vectorRepository.upsertVectors(points);
  }

  public async syncChunks(chunks: any[]): Promise<void> {
    if (!chunks || chunks.length === 0) return;
    const points: VectorPoint[] = [];

    const vectors = await embeddingService.embedBatch(chunks.map(c => c.content));

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vec = vectors[i];
      points.push({
        id: chunk.id,
        vector: vec,
        payload: {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          content: chunk.content,
          title: chunk.documentTitle || 'Knowledge Document',
          type: chunk.type || 'TXT',
          pageNumber: chunk.pageNumber,
          slideNumber: chunk.slideNumber,
          sectionHeader: chunk.sectionHeader,
          collectionId: chunk.collectionId,
          chunkIndex: chunk.chunkIndex,
          userId: chunk.userId,
        },
      });
    }

    if (points.length > 0) {
      await vectorRepository.upsertVectors(points);
      console.log(`[VectorService] Synchronized ${points.length} chunk vectors into Qdrant vector index.`);
    }
  }

  public async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const filter: VectorSearchFilter = {
      documentId: params.filter?.documentId,
      collectionId: params.filter?.collectionId,
      documentType: params.filter?.documentType,
      userId: params.filter?.userId,
    };

    const hits = await vectorRepository.search(params.vector, params.limit, filter);

    return hits.map(hit => ({
      chunkId: hit.payload.chunkId,
      documentId: hit.payload.documentId,
      score: hit.score,
      payload: hit.payload,
    }));
  }

  public async deleteDocumentVectors(documentId: string): Promise<void> {
    await vectorRepository.deleteByDocumentId(documentId);
  }

  public getHealth() {
    return vectorRepository.getHealth();
  }
}

export const vectorService = new VectorService();
