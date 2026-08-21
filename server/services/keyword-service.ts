import { dbService } from '../db/database';
import { Chunk } from '../../src/types';
import { KeywordSearchParams, KeywordSearchResult } from '../types';

interface InvertedIndexEntry {
  chunkId: string;
  tf: number;
  docLength: number;
}

export class KeywordService {
  private k1 = 1.5;
  private b = 0.75;

  private invertedIndex = new Map<string, InvertedIndexEntry[]>();
  private chunkLengths = new Map<string, number>();
  private totalLength = 0;
  private totalChunks = 0;

  constructor() {
    this.rebuildIndex();
  }

  public async rebuildIndex(): Promise<void> {
    const chunks = await dbService.getAllChunks();
    this.invertedIndex.clear();
    this.chunkLengths.clear();
    this.totalLength = 0;
    this.totalChunks = chunks.length;

    for (const chunk of chunks) {
      this.indexChunk(chunk);
    }
  }

  public indexChunk(chunk: Chunk): void {
    this.indexBatch([chunk]);
  }

  public indexBatch(chunks: Chunk[]): void {
    if (!chunks || chunks.length === 0) return;

    for (const chunk of chunks) {
      const fullText = `${chunk.sectionHeader || ''} ${chunk.sectionHeader || ''} ${chunk.content} ${chunk.documentTitle || ''}`;
      const tokens = this.tokenize(fullText);
      const length = Math.max(1, tokens.length);

      this.chunkLengths.set(chunk.id, length);
      this.totalLength += length;
      this.totalChunks++;

      const tfMap = new Map<string, number>();
      for (const t of tokens) {
        tfMap.set(t, (tfMap.get(t) || 0) + 1);
        // Also add singular / root forms if ends with 's' or 'ies'
        if (t.endsWith('s') && t.length > 3) {
          const singular = t.endsWith('ies') ? t.slice(0, -3) + 'y' : t.slice(0, -1);
          tfMap.set(singular, (tfMap.get(singular) || 0) + 0.9);
        }
      }

      for (const [term, tf] of tfMap.entries()) {
        let entries = this.invertedIndex.get(term);
        if (!entries) {
          entries = [];
          this.invertedIndex.set(term, entries);
        }
        entries.push({
          chunkId: chunk.id,
          tf,
          docLength: length,
        });
      }
    }
  }

  public removeDocument(documentId: string): void {
    for (const [term, entries] of this.invertedIndex.entries()) {
      const filtered = entries.filter(e => {
        const chunk = dbService.chunks.get(e.chunkId);
        return chunk && chunk.documentId !== documentId;
      });
      if (filtered.length === 0) {
        this.invertedIndex.delete(term);
      } else {
        this.invertedIndex.set(term, filtered);
      }
    }
  }

  public async search(
    paramsOrQuery: KeywordSearchParams | string,
    limitArg = 10,
    filterArg?: any
  ): Promise<KeywordSearchResult[]> {
    const query = typeof paramsOrQuery === 'string' ? paramsOrQuery : paramsOrQuery.query;
    const limit = typeof paramsOrQuery === 'string' ? limitArg : (paramsOrQuery.limit ?? limitArg);
    const filter = typeof paramsOrQuery === 'string' ? filterArg : paramsOrQuery.filter;

    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }

    const allChunks = await dbService.getAllChunks();
    const chunkMap = new Map(allChunks.map(c => [c.id, c]));
    const N = Math.max(1, allChunks.length);
    const avgdl = this.totalChunks > 0 ? this.totalLength / this.totalChunks : 50;

    const scores = new Map<string, number>();

    for (const term of queryTokens) {
      const entries = this.invertedIndex.get(term) || [];
      const n_q = entries.length;
      if (n_q === 0) continue;

      const idf = Math.log((N - n_q + 0.5) / (n_q + 0.5) + 1);

      for (const entry of entries) {
        const chunk = chunkMap.get(entry.chunkId);
        if (!chunk) continue;

        const doc = dbService.documents.get(chunk.documentId);

        // Apply filters
        if (filter?.userId) {
          const isMatch = chunk.userId === filter.userId || (!chunk.userId && filter.userId === 'user-default-admin');
          if (!isMatch) continue;
        }
        if (filter?.documentId && chunk.documentId !== filter.documentId) continue;
        if (filter?.collectionId && doc?.collectionId !== filter.collectionId) continue;
        if (filter?.documentType && doc?.type !== filter.documentType) continue;

        const tf = entry.tf;
        const len = entry.docLength;
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (len / avgdl));
        const termScore = idf * (numerator / denominator);

        scores.set(entry.chunkId, (scores.get(entry.chunkId) || 0) + termScore);
      }
    }

    const results: KeywordSearchResult[] = [];
    for (const [chunkId, score] of scores.entries()) {
      const chunk = chunkMap.get(chunkId);
      if (!chunk) continue;

      const doc = dbService.documents.get(chunk.documentId);

      results.push({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        score,
        content: chunk.content,
        title: chunk.documentTitle,
        type: doc?.type || 'TXT',
        pageNumber: chunk.pageNumber,
        slideNumber: chunk.slideNumber,
        sectionHeader: chunk.sectionHeader,
      });
    }

    const maxScore = results.length > 0 ? Math.max(...results.map(r => r.score)) : 1;
    results.forEach(r => {
      r.score = maxScore > 0 ? r.score / maxScore : 0;
    });

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  public getStats(): { totalDocuments: number; totalTerms: number; avgDocLength: number } {
    return {
      totalDocuments: this.totalChunks,
      totalTerms: this.invertedIndex.size,
      avgDocLength: this.totalChunks > 0 ? Math.round(this.totalLength / this.totalChunks) : 0,
    };
  }

  private tokenize(text?: string): string[] {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1);
  }
}

export const keywordService = new KeywordService();
