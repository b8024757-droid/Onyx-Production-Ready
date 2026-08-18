import { dbService } from '../db/database';
import { DocumentParserService, NormalizedDocument, NormalizedSection } from '../parsers';
import { storageService } from '../storage/storage-service';
import { embeddingService } from './embedding-service';
import { vectorService } from './vector-service';
import { keywordService } from './keyword-service';
import { visualEvidenceService } from './visual-evidence-service';
import { queueService, IngestionJobData } from './queue-service';
import { Document, Chunk, DocumentType, DocumentCategory } from '../../src/types';
import { IngestionOptions, IngestionResult } from '../types';

export class IngestionService {
  constructor() {
    queueService.registerProcessor(this.processQueuedJob.bind(this));
  }

  /**
   * Main entry point for submitting a document for processing
   */
  public async submitDocumentForIngestion(
    filename: string,
    fileBuffer: Buffer,
    mimeType: string,
    options: IngestionOptions = {}
  ): Promise<{ jobId: string; documentId: string }> {
    const documentId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // 1. Save file to persistent storage
    const storedFile = await storageService.saveFile(filename, fileBuffer, mimeType);

    // 2. Determine collection name
    let collectionName: string | undefined;
    if (options.collectionId) {
      const col = await dbService.getCollectionById(options.collectionId);
      if (col) collectionName = col.name;
    }

    const docType = this.determineDocumentType(filename, mimeType);

    // 3. Create initial Document record in DB
    const initialDoc: Document = {
      id: documentId,
      userId: options.userId || 'user-default-admin',
      title: filename,
      originalName: filename,
      type: docType,
      category: this.determineCategory(docType),
      status: 'UPLOADING',
      progress: 10,
      statusMessage: 'File uploaded and queued for processing',
      collectionId: options.collectionId,
      collectionName,
      chunkCount: 0,
      sizeBytes: fileBuffer.length,
      tags: options.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbService.saveDocument(initialDoc);

    // 4. Enqueue background processing job
    await queueService.addIngestionJob({
      jobId,
      userId: options.userId || 'user-default-admin',
      documentId,
      filename,
      fileType: docType,
      fileSizeBytes: fileBuffer.length,
      storagePath: storedFile.storagePath,
      mimeType,
      collectionId: options.collectionId,
      tags: options.tags,
      chunkSize: options.chunkSize || 500,
      chunkOverlap: options.chunkOverlap || 50,
    });

    return { jobId, documentId };
  }

  /**
   * Main entry point for submitting a URL for processing
   */
  public async submitUrlForIngestion(
    url: string,
    options: IngestionOptions = {}
  ): Promise<{ jobId: string; documentId: string }> {
    const documentId = `doc-url-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobId = `job-url-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    let collectionName: string | undefined;
    if (options.collectionId) {
      const col = await dbService.getCollectionById(options.collectionId);
      if (col) collectionName = col.name;
    }

    const initialDoc: Document = {
      id: documentId,
      userId: options.userId || 'user-default-admin',
      title: url,
      originalName: url,
      type: 'URL',
      category: 'Web',
      status: 'UPLOADING',
      progress: 10,
      statusMessage: 'Web URL queued for crawling',
      collectionId: options.collectionId,
      collectionName,
      chunkCount: 0,
      sizeBytes: 0,
      sourceUrl: url,
      tags: options.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbService.saveDocument(initialDoc);

    await queueService.addIngestionJob({
      jobId,
      userId: options.userId || 'user-default-admin',
      documentId,
      filename: url,
      fileType: 'URL',
      fileSizeBytes: 0,
      url,
      collectionId: options.collectionId,
      tags: options.tags,
      chunkSize: options.chunkSize || 500,
      chunkOverlap: options.chunkOverlap || 50,
    });

    return { jobId, documentId };
  }

  /**
   * Worker processor executing full extraction, chunking, embedding, and indexing pipeline
   */
  private async processQueuedJob(
    data: IngestionJobData,
    updateProgress: (progress: number, stage: string) => Promise<void>
  ): Promise<IngestionResult> {
    try {
      const startTime = Date.now();
      let parsingTimeMs = 0;
      let chunkingTimeMs = 0;
      let embeddingTimeMs = 0;
      let indexingTimeMs = 0;

      // --- STAGE 1: PARSING ---
      await updateProgress(25, 'Parsing document structure and extracting text');
      const parseStart = Date.now();

      let parsedDoc: NormalizedDocument;
      let rawFileBuffer: Buffer | null = null;

      if (data.url) {
        parsedDoc = await DocumentParserService.parseUrl(data.url);
      } else if (data.storagePath) {
        rawFileBuffer = await storageService.getFileBuffer(data.storagePath);
        parsedDoc = await DocumentParserService.parseFile(data.filename, rawFileBuffer, data.mimeType);
      } else if (data.content) {
        const contentStr = String(data.content);
        if (contentStr.startsWith('data:')) {
          const commaIdx = contentStr.indexOf(',');
          const b64 = commaIdx !== -1 ? contentStr.slice(commaIdx + 1) : contentStr;
          rawFileBuffer = Buffer.from(b64.trim(), 'base64');
        } else {
          rawFileBuffer = Buffer.from(contentStr, 'utf-8');
        }
        parsedDoc = await DocumentParserService.parseFile(data.filename, rawFileBuffer, data.mimeType);
      } else {
        throw new Error('No source content or file provided for ingestion.');
      }
      parsingTimeMs = Date.now() - parseStart;

      // Update document title and structure
      const doc = await dbService.getDocumentById(data.documentId);
      if (doc) {
        doc.title = parsedDoc.title || data.filename || data.url || 'Document';
        doc.type = parsedDoc.documentType;
        doc.category = this.determineCategory(parsedDoc.documentType);
        doc.pageCount = parsedDoc.pageCount;
        doc.slideCount = parsedDoc.slideCount;
        doc.sectionCount = parsedDoc.sections.length;
        doc.summary = parsedDoc.sections[0]?.content.slice(0, 200);
        doc.contentPreview = parsedDoc.sections.slice(0, 3).map(s => s.content).join('\n\n').slice(0, 500);
        await dbService.saveDocument(doc);
      }

      // --- STAGE 2: STRUCTURE-AWARE CHUNKING & MULTIMODAL EXTRACTION ---
      await updateProgress(50, 'Segmenting text into structure-aware semantic chunks & extracting visual evidence');
      const chunkStart = Date.now();

      const targetChunkSize = data.chunkSize || 500;
      const targetOverlap = data.chunkOverlap || 50;
      const chunks: Chunk[] = this.createStructureAwareChunks(
        data.documentId,
        doc?.title || parsedDoc.title,
        parsedDoc.sections,
        targetChunkSize,
        targetOverlap
      );

      // Multimodal Visual Evidence Extraction for PDFs
      if (parsedDoc.documentType === 'PDF' && rawFileBuffer) {
        try {
          const visualResult = await visualEvidenceService.extractPdfVisualEvidence(
            data.documentId,
            doc?.title || parsedDoc.title,
            rawFileBuffer,
            chunks.length
          );
          if (visualResult.chunks && visualResult.chunks.length > 0) {
            chunks.push(...visualResult.chunks);
            console.log(`[IngestionService] Extracted ${visualResult.figures.length} visual figures (${visualResult.chunks.length} visual chunks) for doc ${data.documentId}`);
          }
        } catch (visErr: any) {
          console.warn(`[IngestionService] Visual evidence extraction warning (non-fatal): ${visErr.message}`);
        }
      }

      chunkingTimeMs = Date.now() - chunkStart;

      if (chunks.length === 0) {
        throw new Error('No readable text content or visual evidence extracted from document.');
      }

      // --- STAGE 3: EMBEDDING ---
      await updateProgress(75, `Generating embeddings for ${chunks.length} chunks via Gemini (${embeddingService.getModelName()})`);
      const embedStart = Date.now();

      const chunkTexts = chunks.map(c => c.content);
      const vectors = await embeddingService.embedBatch(chunkTexts);

      const vectorPoints = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        chunk.userId = data.userId || 'user-default-admin';
        const vector = vectors[i];

        vectorPoints.push({
          id: `${chunk.documentId}_${chunk.chunkIndex}`,
          vector,
          payload: {
            chunkId: chunk.id,
            documentId: chunk.documentId,
            content: chunk.content,
            title: chunk.documentTitle,
            type: doc?.type || parsedDoc.documentType,
            pageNumber: chunk.pageNumber,
            slideNumber: chunk.slideNumber,
            sectionHeader: chunk.sectionHeader,
            collectionId: data.collectionId,
            sourceUrl: data.url,
            chunkIndex: chunk.chunkIndex,
            userId: data.userId || 'user-default-admin',
          },
        });
      }
      embeddingTimeMs = Date.now() - embedStart;

      // --- STAGE 4: INDEXING (Vector DB + BM25 + PostgreSQL) ---
      await updateProgress(90, 'Upserting vectors into Qdrant and building BM25 index');
      const indexStart = Date.now();

      // 1. Upsert vectors to Qdrant/VectorService
      await vectorService.upsertChunkVectors(vectorPoints);

      // 2. Index in BM25
      for (const chk of chunks) {
        keywordService.indexChunk(chk);
      }

      // 3. Save chunks in PostgreSQL
      await dbService.saveChunks(chunks);

      // 4. Update Document record
      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
      if (doc) {
        doc.status = 'READY';
        doc.progress = 100;
        doc.statusMessage = `Successfully indexed (${chunks.length} chunks)`;
        doc.chunkCount = chunks.length;
        doc.userId = data.userId || doc.userId || 'user-default-admin';
        doc.updatedAt = new Date().toISOString();
        await dbService.saveDocument(doc);
      }

      // 5. Update collection document count
      if (data.collectionId) {
        const col = await dbService.getCollectionById(data.collectionId, data.userId);
        if (col) {
          col.documentCount = (col.documentCount || 0) + 1;
          col.updatedAt = new Date().toISOString();
          await dbService.saveCollection(col);
        }
      }
      indexingTimeMs = Date.now() - indexStart;

      // --- STAGE 5: READY ---
      await updateProgress(100, `Successfully indexed ${chunks.length} chunks (${totalTokens} tokens)`);
      const totalTimeMs = Date.now() - startTime;

      // Log Activity
      dbService.addActivity({
        id: `act-${Date.now()}`,
        userId: data.userId || 'user-default-admin',
        type: 'index_complete',
        title: 'Document Ingestion Complete',
        description: `Indexed ${chunks.length} chunks into Qdrant & BM25 (${Math.round(totalTimeMs)}ms)`,
        timestamp: new Date().toISOString(),
        documentId: data.documentId,
      });

      // Real Application Notification: Ready
      const docName = doc?.title || data.filename || 'Document';
      const isMultimodal = chunks.some(c => c.metadata?.isVisual || c.id.includes('-vis-'));
      dbService.addNotification({
        id: `notif-ready-${data.documentId}`,
        userId: data.userId || 'user-default-admin',
        type: 'SUCCESS',
        title: 'Document Ready',
        message: isMultimodal
          ? `${docName} indexed with visual evidence & charts.`
          : `${docName} has been indexed successfully.`,
        timestamp: new Date().toISOString(),
        read: false,
        documentId: data.documentId,
        linkTab: 'knowledge',
      });

      return {
        documentId: data.documentId,
        chunksCreated: chunks.length,
        status: 'READY',
        metrics: {
          parsingTimeMs,
          chunkingTimeMs,
          embeddingTimeMs,
          indexingTimeMs,
          totalTimeMs,
        },
      };
    } catch (err: any) {
      console.error(`[IngestionService] Ingestion failed for document ${data.documentId}: ${err.message || err}`);
      const doc = await dbService.getDocumentById(data.documentId);
      if (doc) {
        doc.status = 'FAILED';
        doc.statusMessage = `Ingestion failed: ${err.message || 'Error'}`;
        doc.updatedAt = new Date().toISOString();
        await dbService.saveDocument(doc);
      }
      const job = await dbService.getJob(data.jobId);
      if (job) {
        job.status = 'FAILED';
        job.error = err.message || 'Processing failed';
        job.completedAt = new Date().toISOString();
        await dbService.saveJob(job);
      }

      // Real Application Notification: Failed
      const failedDocName = doc?.title || data.filename || 'Document';
      dbService.addNotification({
        id: `notif-failed-${data.documentId}`,
        type: 'ERROR',
        title: 'Document Processing Failed',
        message: `${failedDocName} could not be indexed.`,
        timestamp: new Date().toISOString(),
        read: false,
        documentId: data.documentId,
        linkTab: 'knowledge',
      });

      throw err;
    }
  }

  /**
   * Structure-Aware Chunking Implementation
   */
  private createStructureAwareChunks(
    documentId: string,
    documentTitle: string,
    sections: NormalizedSection[],
    targetChunkSize: number,
    targetOverlap: number
  ): Chunk[] {
    const chunks: Chunk[] = [];
    let chunkIndex = 0;

    for (const section of sections) {
      const sectionText = section.content.trim();
      if (!sectionText) continue;

      if (sectionText.length <= targetChunkSize * 1.2) {
        chunks.push({
          id: `chk-${documentId}-${chunkIndex}`,
          documentId,
          documentTitle,
          chunkIndex,
          content: sectionText,
          tokenCount: Math.ceil(sectionText.length / 4),
          pageNumber: section.pageNumber,
          slideNumber: section.slideNumber,
          sectionHeader: section.heading,
        });
        chunkIndex++;
        continue;
      }

      let cursor = 0;
      while (cursor < sectionText.length) {
        let end = Math.min(cursor + targetChunkSize, sectionText.length);

        if (end < sectionText.length) {
          const lookbackWindow = sectionText.slice(cursor + targetChunkSize * 0.5, end + 50);
          const paraBreak = lookbackWindow.lastIndexOf('\n\n');
          const sentenceBreak = lookbackWindow.lastIndexOf('. ');

          if (paraBreak !== -1) {
            end = cursor + Math.floor(targetChunkSize * 0.5) + paraBreak + 2;
          } else if (sentenceBreak !== -1) {
            end = cursor + Math.floor(targetChunkSize * 0.5) + sentenceBreak + 2;
          }
        }

        const chunkText = sectionText.slice(cursor, end).trim();
        if (chunkText.length > 20) {
          chunks.push({
            id: `chk-${documentId}-${chunkIndex}`,
            documentId,
            documentTitle,
            chunkIndex,
            content: chunkText,
            tokenCount: Math.ceil(chunkText.length / 4),
            pageNumber: section.pageNumber,
            slideNumber: section.slideNumber,
            sectionHeader: section.heading,
          });
          chunkIndex++;
        }

        if (end >= sectionText.length) break;
        cursor = Math.max(cursor + 1, end - targetOverlap);
      }
    }

    return chunks;
  }

  private determineDocumentType(filename: string, mimeType?: string): DocumentType {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf' || mimeType?.includes('pdf')) return 'PDF';
    if (ext === 'docx' || ext === 'doc' || mimeType?.includes('word')) return 'DOCX';
    if (ext === 'pptx' || ext === 'ppt' || mimeType?.includes('presentation')) return 'PPTX';
    if (ext === 'xlsx' || ext === 'xls' || mimeType?.includes('spreadsheet')) return 'XLSX';
    if (ext === 'csv' || mimeType === 'text/csv') return 'CSV';
    if (ext === 'html' || ext === 'htm') return 'HTML';
    if (ext === 'md' || ext === 'markdown') return 'MD';
    if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || mimeType?.startsWith('image/')) return 'IMAGE';
    return 'TXT';
  }

  private determineCategory(type: DocumentType): DocumentCategory {
    switch (type) {
      case 'PDF':
      case 'DOC':
      case 'DOCX':
      case 'TXT':
      case 'CSV':
      case 'XLS':
      case 'XLSX':
        return 'Documents';
      case 'PPT':
      case 'PPTX':
        return 'Presentations';
      case 'MD':
        return 'Notes';
      case 'URL':
      case 'HTML':
        return 'Web';
      case 'IMAGE':
        return 'Images';
      default:
        return 'Documents';
    }
  }
}

export const ingestionService = new IngestionService();
