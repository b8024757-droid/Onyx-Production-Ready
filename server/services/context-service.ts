import { RerankedCandidate } from './rerank-service';
import { Citation, Chunk } from '../../src/types';
import { GroundedContext } from '../types';

export class ContextService {
  /**
   * Builds the structured grounded context prompt for Gemini with precise citation mappings
   */
  public static buildGroundedContext(
    candidates: RerankedCandidate[],
    maxTokens = 3500
  ): GroundedContext {
    const citations: Citation[] = [];
    const chunks: Chunk[] = [];
    const sourceBlocks: string[] = [];
    let currentTokenEstimate = 0;

    // Deduplicate overlapping content
    const seenContentHashes = new Set<string>();

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const normalizedContent = cand.content.trim().slice(0, 100);

      if (seenContentHashes.has(normalizedContent)) {
        continue;
      }
      seenContentHashes.add(normalizedContent);

      const chunkTokens = Math.ceil(cand.content.length / 4);
      if (currentTokenEstimate + chunkTokens > maxTokens && sourceBlocks.length >= 2) {
        break; // Respect token budget
      }

      const citationIndex = sourceBlocks.length + 1;
      const formattedIndex = citationIndex < 10 ? `0${citationIndex}` : `${citationIndex}`;

      // Build structured source block
      let header = `[SOURCE ${formattedIndex}] Title: ${cand.title} | Type: ${cand.type}`;
      if (cand.pageNumber) header += ` | Page: ${cand.pageNumber}`;
      if (cand.slideNumber) header += ` | Slide: ${cand.slideNumber}`;
      if (cand.sectionHeader) header += ` | Section: ${cand.sectionHeader}`;

      sourceBlocks.push(`${header}\n${cand.content}`);
      currentTokenEstimate += chunkTokens + 20;

      // Create Citation object for frontend Evidence Inspector
      const citation: Citation = {
        id: `cit-${cand.chunkId}-${citationIndex}`,
        citationIndex,
        documentId: cand.documentId,
        documentTitle: cand.title,
        sourceType: cand.type,
        pageNumber: cand.pageNumber,
        slideNumber: cand.slideNumber,
        section: cand.sectionHeader,
        chunkId: cand.chunkId,
        excerpt: cand.content,
        addedDate: new Date().toLocaleDateString(),
        score: Math.round(cand.finalScore * 100) / 100,
        isVisual: cand.isVisual || cand.metadata?.isVisual,
        visualType: cand.visualType || cand.metadata?.figureType || cand.metadata?.visualType,
        figureId: cand.figureId || cand.metadata?.figureId,
        figureTitle: cand.figureTitle || cand.metadata?.figureTitle,
        axes: cand.axes || cand.metadata?.axes,
        legend: cand.legend || cand.metadata?.legend,
        trendSummary: cand.trendSummary || cand.metadata?.trendSummary,
        keyValues: cand.keyValues || cand.metadata?.keyValues,
      };

      citations.push(citation);

      chunks.push({
        id: cand.chunkId,
        documentId: cand.documentId,
        documentTitle: cand.title,
        chunkIndex: i,
        content: cand.content,
        tokenCount: chunkTokens,
        pageNumber: cand.pageNumber,
        slideNumber: cand.slideNumber,
        sectionHeader: cand.sectionHeader,
      });
    }

    const promptContext = sourceBlocks.join('\n\n---\n\n');

    return {
      promptContext,
      citations,
      chunks,
      tokenCount: currentTokenEstimate,
    };
  }
}
