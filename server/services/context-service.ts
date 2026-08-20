import { RerankedCandidate } from './rerank-service';
import { Citation, Chunk } from '../../src/types';
import { GroundedContext } from '../types';

export class ContextService {
  /**
   * Builds the structured grounded context prompt for Gemini with precise citation mappings
   */
  public static buildGroundedContext(
    candidates: RerankedCandidate[],
    maxTokens = 6000
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
      if (currentTokenEstimate + chunkTokens > maxTokens && sourceBlocks.length >= 4) {
        break; // Respect token budget while ensuring broad coverage
      }

      const citationIndex = sourceBlocks.length + 1;
      const formattedIndex = citationIndex < 10 ? `0${citationIndex}` : `${citationIndex}`;

      // Build structured source block
      let header = `[SOURCE ${formattedIndex}] Title: ${cand.title} | Type: ${cand.type}`;
      if (cand.pageNumber) header += ` | Page: ${cand.pageNumber}`;
      if (cand.slideNumber) header += ` | Slide: ${cand.slideNumber}`;
      if (cand.sectionHeader) header += ` | Section: ${cand.sectionHeader}`;

      let blockContent = cand.content;

      // Enrich with visual elements if present
      if (cand.isVisual || cand.metadata?.isVisual) {
        const vType = cand.visualType || cand.metadata?.figureType || cand.metadata?.visualType || 'Figure';
        const fId = cand.figureId || cand.metadata?.figureId;
        const fTitle = cand.figureTitle || cand.metadata?.figureTitle;
        const trend = cand.trendSummary || cand.metadata?.trendSummary;
        const axes = cand.axes || cand.metadata?.axes;
        const legend = cand.legend || cand.metadata?.legend;
        const keyVals = cand.keyValues || cand.metadata?.keyValues;

        header += ` | Visual Type: ${vType}`;
        if (fId) header += ` | Figure ID: ${fId}`;
        if (fTitle) header += ` | Figure Title: ${fTitle}`;

        const visualDetails: string[] = [];
        if (trend) visualDetails.push(`[Visual Finding / Trend]: ${trend}`);
        if (axes && (axes.x || axes.y)) visualDetails.push(`[Axes]: X: ${axes.x || 'N/A'}, Y: ${axes.y || 'N/A'}`);
        if (legend && legend.length > 0) visualDetails.push(`[Legend]: ${legend.join(', ')}`);
        if (keyVals && keyVals.length > 0) visualDetails.push(`[Key Data Points]: ${keyVals.join(', ')}`);

        if (visualDetails.length > 0) {
          blockContent += `\n${visualDetails.join('\n')}`;
        }
      }

      sourceBlocks.push(`${header}\n${blockContent}`);
      currentTokenEstimate += chunkTokens + 30;

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
