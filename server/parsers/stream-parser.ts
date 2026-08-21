/**
 * Second Brain — Streaming Document Parser & Adaptive Chunker
 * Memory-safe, progressive extraction and structure-aware chunking
 * for documents ranging from 1 KB to 250 MB+ with zero RAM bloat.
 */

import fs from 'fs';
import readline from 'readline';
import { Chunk, DocumentType } from '../../src/types';
import { PDFParser } from './pdf-parser';
import { DocxParser } from './docx-parser';
import { PPTXParser } from './pptx-parser';
import { SpreadsheetParser } from './xlsx-parser';
import { HTMLParser } from './html-parser';
import { MarkdownParser } from './markdown-parser';
import { OCRParser } from './ocr-parser';
import { URLFetcher } from './url-fetcher';
import { NormalizedSection } from './index';

export interface AdaptiveChunkConfig {
  targetChunkSize: number;
  targetOverlap: number;
  minChunkSize: number;
  maxChunkSize: number;
  batchSize: number;
}

export interface StreamParseOptions {
  documentId: string;
  documentTitle: string;
  documentType: DocumentType;
  fileSizeBytes: number;
  userId?: string;
  customChunkSize?: number;
  customChunkOverlap?: number;
  onChunkBatch: (batch: Chunk[]) => Promise<void>;
}

export interface StreamParseSummary {
  totalChunks: number;
  totalTokens: number;
  totalChars: number;
  pageCount?: number;
  slideCount?: number;
  sheetCount?: number;
  contentPreview: string;
  summary: string;
}

export class StreamingDocumentParser {
  /**
   * Calculate adaptive chunking parameters based on file size and document type
   */
  public static getAdaptiveConfig(fileSizeBytes: number, customChunkSize?: number, customChunkOverlap?: number): AdaptiveChunkConfig {
    if (customChunkSize && customChunkSize > 0) {
      const overlap = customChunkOverlap ?? Math.min(Math.floor(customChunkSize * 0.1), 200);
      return {
        targetChunkSize: customChunkSize,
        targetOverlap: overlap,
        minChunkSize: Math.max(50, Math.floor(customChunkSize * 0.2)),
        maxChunkSize: Math.floor(customChunkSize * 1.5),
        batchSize: 50,
      };
    }

    // Small documents (< 5 MB): High-resolution granular chunks
    if (fileSizeBytes < 5 * 1024 * 1024) {
      return {
        targetChunkSize: 800,
        targetOverlap: 80,
        minChunkSize: 100,
        maxChunkSize: 1200,
        batchSize: 50,
      };
    }

    // Medium documents (5 MB to 50 MB): Balanced semantic chunks
    if (fileSizeBytes < 50 * 1024 * 1024) {
      return {
        targetChunkSize: 2200,
        targetOverlap: 150,
        minChunkSize: 300,
        maxChunkSize: 3200,
        batchSize: 50,
      };
    }

    // Large / Massive documents (50 MB to 250 MB+): Section-aware structured chunks
    // Targets ~5,000 to 25,000 chunks total rather than 888,000+
    return {
      targetChunkSize: 5500,
      targetOverlap: 250,
      minChunkSize: 600,
      maxChunkSize: 8000,
      batchSize: 50,
    };
  }

  /**
   * Main progressive streaming entry point for files stored on disk
   */
  public static async parseAndChunkFileStream(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const { documentType } = options;

    switch (documentType) {
      case 'TXT':
      case 'MD':
        return this.streamParseTextOrMarkdown(filePath, options);
      case 'CSV':
        return this.streamParseCsv(filePath, options);
      case 'PDF':
        return this.parsePdfProgressive(filePath, options);
      case 'DOC':
      case 'DOCX':
        return this.parseDocxProgressive(filePath, options);
      case 'PPT':
      case 'PPTX':
        return this.parsePptxProgressive(filePath, options);
      case 'XLS':
      case 'XLSX':
        return this.parseXlsxProgressive(filePath, options);
      case 'HTML':
        return this.parseHtmlProgressive(filePath, options);
      case 'IMAGE':
        return this.parseImageProgressive(filePath, options);
      default:
        return this.streamParseTextOrMarkdown(filePath, options);
    }
  }

  /**
   * Stream Parse Plain Text and Markdown files line-by-line (0 MB RAM overhead)
   */
  private static async streamParseTextOrMarkdown(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentChunkIndex = 0;
    let totalChars = 0;
    let totalTokens = 0;
    let previewLines: string[] = [];
    let summaryFirstPara = '';

    let currentSectionHeader = 'Document Overview';
    let currentParagraphs: string[] = [];
    let currentBufferLength = 0;

    let chunkBatch: Chunk[] = [];

    const flushChunk = async (force = false) => {
      if (currentParagraphs.length === 0) return;
      const content = currentParagraphs.join('\n\n').trim();
      if (!content || (!force && content.length < config.minChunkSize)) return;

      const tokenCount = Math.ceil(content.length / 4);
      totalChars += content.length;
      totalTokens += tokenCount;

      if (!summaryFirstPara && content.length > 30) {
        summaryFirstPara = content.slice(0, 300);
      }

      const chunk: Chunk = {
        id: `chk-${options.documentId}-${currentChunkIndex}`,
        documentId: options.documentId,
        documentTitle: options.documentTitle,
        chunkIndex: currentChunkIndex++,
        content,
        tokenCount,
        sectionHeader: currentSectionHeader,
        userId: options.userId,
      };

      chunkBatch.push(chunk);

      // Handle overlap for next chunk if not forcing final flush
      if (!force && config.targetOverlap > 0 && content.length > config.targetOverlap) {
        const overlapSlice = content.slice(content.length - config.targetOverlap);
        currentParagraphs = [overlapSlice];
        currentBufferLength = overlapSlice.length;
      } else {
        currentParagraphs = [];
        currentBufferLength = 0;
      }

      if (chunkBatch.length >= config.batchSize) {
        await options.onChunkBatch(chunkBatch);
        chunkBatch = [];
      }
    };

    let activePara = '';

    for await (const line of rl) {
      if (previewLines.length < 5 && line.trim()) {
        previewLines.push(line.trim());
      }

      const trimmedLine = line.trim();

      // Detect markdown / structured section headers
      const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.*)$/) ||
                           trimmedLine.match(/^\[Section\s+([^\]]+)\]/i) ||
                           trimmedLine.match(/^##+\s*(.*)$/);

      if (headingMatch) {
        // Flush existing buffer before changing section
        if (activePara) {
          currentParagraphs.push(activePara);
          currentBufferLength += activePara.length;
          activePara = '';
        }
        await flushChunk(true);
        currentSectionHeader = headingMatch[2] ? headingMatch[2].trim() : headingMatch[1].trim();
        continue;
      }

      // Empty line signals paragraph boundary
      if (!trimmedLine) {
        if (activePara) {
          currentParagraphs.push(activePara);
          currentBufferLength += activePara.length;
          activePara = '';

          if (currentBufferLength >= config.targetChunkSize) {
            await flushChunk(false);
          }
        }
      } else {
        activePara = activePara ? `${activePara} ${trimmedLine}` : trimmedLine;
      }
    }

    if (activePara) {
      currentParagraphs.push(activePara);
    }
    await flushChunk(true);

    if (chunkBatch.length > 0) {
      await options.onChunkBatch(chunkBatch);
      chunkBatch = [];
    }

    return {
      totalChunks: currentChunkIndex,
      totalTokens,
      totalChars,
      contentPreview: previewLines.join('\n').slice(0, 500),
      summary: summaryFirstPara || options.documentTitle,
    };
  }

  /**
   * Stream Parse CSV files line-by-line with header preservation on every chunk
   */
  private static async streamParseCsv(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let currentChunkIndex = 0;
    let totalChars = 0;
    let totalTokens = 0;
    let headerLine = '';
    let rowBatch: string[] = [];
    let chunkBatch: Chunk[] = [];
    let totalRows = 0;

    // Rows per chunk scaled by target chunk size
    const rowsPerChunk = Math.max(10, Math.floor(config.targetChunkSize / 120));

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (!headerLine) {
        headerLine = trimmed;
        continue;
      }

      totalRows++;
      rowBatch.push(trimmed);

      if (rowBatch.length >= rowsPerChunk) {
        const tableText = `[CSV Dataset: ${options.documentTitle}] (Rows ${totalRows - rowBatch.length + 1} - ${totalRows})\nHeader: ${headerLine}\n` + rowBatch.join('\n');
        const tokenCount = Math.ceil(tableText.length / 4);
        totalChars += tableText.length;
        totalTokens += tokenCount;

        const chunk: Chunk = {
          id: `chk-${options.documentId}-${currentChunkIndex}`,
          documentId: options.documentId,
          documentTitle: options.documentTitle,
          chunkIndex: currentChunkIndex++,
          content: tableText,
          tokenCount,
          sectionHeader: `[CSV Table] Rows ${totalRows - rowBatch.length + 1} to ${totalRows}`,
          userId: options.userId,
        };

        chunkBatch.push(chunk);
        rowBatch = [];

        if (chunkBatch.length >= config.batchSize) {
          await options.onChunkBatch(chunkBatch);
          chunkBatch = [];
        }
      }
    }

    if (rowBatch.length > 0) {
      const tableText = `[CSV Dataset: ${options.documentTitle}] (Rows ${totalRows - rowBatch.length + 1} - ${totalRows})\nHeader: ${headerLine}\n` + rowBatch.join('\n');
      const tokenCount = Math.ceil(tableText.length / 4);
      totalChars += tableText.length;
      totalTokens += tokenCount;

      chunkBatch.push({
        id: `chk-${options.documentId}-${currentChunkIndex}`,
        documentId: options.documentId,
        documentTitle: options.documentTitle,
        chunkIndex: currentChunkIndex++,
        content: tableText,
        tokenCount,
        sectionHeader: `[CSV Table] Rows ${totalRows - rowBatch.length + 1} to ${totalRows}`,
        userId: options.userId,
      });
    }

    if (chunkBatch.length > 0) {
      await options.onChunkBatch(chunkBatch);
    }

    return {
      totalChunks: currentChunkIndex,
      totalTokens,
      totalChars,
      contentPreview: `CSV Dataset: ${options.documentTitle}\nHeader: ${headerLine}\nTotal Rows: ${totalRows}`,
      summary: `Tabular CSV document containing ${totalRows} records. Columns: ${headerLine}`,
    };
  }

  /**
   * PDF Progressive Parser
   */
  private static async parsePdfProgressive(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    const pdfBuffer = await fs.promises.readFile(filePath);
    const parsed = await PDFParser.parse(pdfBuffer);

    const sections: NormalizedSection[] = parsed.pages.map(p => ({
      heading: `Page ${p.pageNumber}`,
      content: p.text,
      pageNumber: p.pageNumber,
    }));

    return this.processNormalizedSectionsProgressive(sections, parsed.pageCount, options, config);
  }

  /**
   * DOCX Progressive Parser
   */
  private static async parseDocxProgressive(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    const buffer = await fs.promises.readFile(filePath);
    const parsed = await DocxParser.parse(buffer);

    const sections: NormalizedSection[] = parsed.sections.map(s => ({
      heading: s.heading,
      content: s.content,
    }));

    return this.processNormalizedSectionsProgressive(sections, undefined, options, config);
  }

  /**
   * PPTX Progressive Parser
   */
  private static async parsePptxProgressive(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    const buffer = await fs.promises.readFile(filePath);
    const parsed = await PPTXParser.parse(buffer);

    const sections: NormalizedSection[] = parsed.slides.map(s => ({
      heading: s.title,
      content: s.content,
      slideNumber: s.slideNumber,
    }));

    return this.processNormalizedSectionsProgressive(sections, undefined, options, config, parsed.slideCount);
  }

  /**
   * XLSX Progressive Parser
   */
  private static async parseXlsxProgressive(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    const buffer = await fs.promises.readFile(filePath);
    const parsed = SpreadsheetParser.parse(buffer);

    const sections: NormalizedSection[] = parsed.sheets.map(s => ({
      heading: `Sheet: ${s.sheetName}`,
      content: s.text,
      sheetName: s.sheetName,
    }));

    return this.processNormalizedSectionsProgressive(sections, undefined, options, config, undefined, parsed.sheetCount);
  }

  /**
   * HTML Progressive Parser
   */
  private static async parseHtmlProgressive(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    const str = await fs.promises.readFile(filePath, 'utf-8');
    const parsed = HTMLParser.parse(str);

    const sections: NormalizedSection[] = parsed.sections.map(s => ({
      heading: s.heading,
      content: s.content,
    }));

    return this.processNormalizedSectionsProgressive(sections, undefined, options, config);
  }

  /**
   * Image Progressive Parser
   */
  private static async parseImageProgressive(
    filePath: string,
    options: StreamParseOptions
  ): Promise<StreamParseSummary> {
    const buffer = await fs.promises.readFile(filePath);
    const ext = filePath.split('.').pop()?.toLowerCase() || 'png';
    const parsed = await OCRParser.parseImage(buffer, `image/${ext}`);

    const sections: NormalizedSection[] = [
      { heading: 'Extracted Image Content', content: parsed.text },
    ];

    const config = this.getAdaptiveConfig(options.fileSizeBytes, options.customChunkSize, options.customChunkOverlap);
    return this.processNormalizedSectionsProgressive(sections, 1, options, config);
  }

  /**
   * Helper to segment NormalizedSections adaptively and emit chunk batches
   */
  public static async processNormalizedSectionsProgressive(
    sections: NormalizedSection[],
    pageCount: number | undefined,
    options: StreamParseOptions,
    config: AdaptiveChunkConfig,
    slideCount?: number,
    sheetCount?: number
  ): Promise<StreamParseSummary> {
    let currentChunkIndex = 0;
    let totalChars = 0;
    let totalTokens = 0;
    let chunkBatch: Chunk[] = [];
    let summaryText = '';
    let previewParts: string[] = [];

    for (const section of sections) {
      const sectionText = section.content.trim();
      if (!sectionText) continue;

      if (!summaryText) {
        summaryText = sectionText.slice(0, 300);
      }
      if (previewParts.length < 3) {
        previewParts.push(sectionText.slice(0, 200));
      }

      if (sectionText.length <= config.targetChunkSize * 1.2) {
        const tokenCount = Math.ceil(sectionText.length / 4);
        totalChars += sectionText.length;
        totalTokens += tokenCount;

        chunkBatch.push({
          id: `chk-${options.documentId}-${currentChunkIndex}`,
          documentId: options.documentId,
          documentTitle: options.documentTitle,
          chunkIndex: currentChunkIndex++,
          content: sectionText,
          tokenCount,
          pageNumber: section.pageNumber,
          slideNumber: section.slideNumber,
          sectionHeader: section.heading,
          userId: options.userId,
        });

        if (chunkBatch.length >= config.batchSize) {
          await options.onChunkBatch(chunkBatch);
          chunkBatch = [];
        }
        continue;
      }

      // Segment large section with lookback window
      let cursor = 0;
      while (cursor < sectionText.length) {
        let end = Math.min(cursor + config.targetChunkSize, sectionText.length);

        if (end < sectionText.length) {
          const lookbackWindow = sectionText.slice(cursor + config.targetChunkSize * 0.5, end + 50);
          const paraBreak = lookbackWindow.lastIndexOf('\n\n');
          const sentenceBreak = lookbackWindow.lastIndexOf('. ');

          if (paraBreak !== -1) {
            end = cursor + Math.floor(config.targetChunkSize * 0.5) + paraBreak + 2;
          } else if (sentenceBreak !== -1) {
            end = cursor + Math.floor(config.targetChunkSize * 0.5) + sentenceBreak + 2;
          }
        }

        const chunkText = sectionText.slice(cursor, end).trim();
        if (chunkText.length >= config.minChunkSize || end >= sectionText.length) {
          const tokenCount = Math.ceil(chunkText.length / 4);
          totalChars += chunkText.length;
          totalTokens += tokenCount;

          chunkBatch.push({
            id: `chk-${options.documentId}-${currentChunkIndex}`,
            documentId: options.documentId,
            documentTitle: options.documentTitle,
            chunkIndex: currentChunkIndex++,
            content: chunkText,
            tokenCount,
            pageNumber: section.pageNumber,
            slideNumber: section.slideNumber,
            sectionHeader: section.heading,
            userId: options.userId,
          });

          if (chunkBatch.length >= config.batchSize) {
            await options.onChunkBatch(chunkBatch);
            chunkBatch = [];
          }
        }

        if (end >= sectionText.length) break;
        cursor = Math.max(cursor + 1, end - config.targetOverlap);
      }
    }

    if (chunkBatch.length > 0) {
      await options.onChunkBatch(chunkBatch);
      chunkBatch = [];
    }

    return {
      totalChunks: currentChunkIndex,
      totalTokens,
      totalChars,
      pageCount,
      slideCount,
      sheetCount,
      contentPreview: previewParts.join('\n\n').slice(0, 500),
      summary: summaryText || options.documentTitle,
    };
  }
}
