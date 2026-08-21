/**
 * Second Brain — Ingestion Service
 * Handles memory-safe progressive document extraction, adaptive structure-aware chunking,
 * bounded batch embedding via Gemini, Qdrant vector indexing, and BM25 lexical inverted indexing.
 */

import crypto from 'crypto';
import fs from 'fs';
import { dbService } from '../db/database';
import { DocumentParserService, NormalizedDocument } from '../parsers';
import { StreamingDocumentParser, StreamParseSummary } from '../parsers/stream-parser';
import { storageService, StoredFile } from '../storage/storage-service';
import { embeddingService } from './embedding-service';
import { vectorService } from './vector-service';
import { keywordService } from './keyword-service';
import { visualEvidenceService } from './visual-evidence-service';
import { queueService, IngestionJobData } from './queue-service';
import { Document, Chunk, DocumentType, DocumentCategory, DocumentMetrics } from '../../src/types';
import { IngestionOptions, IngestionResult } from '../types';

export class IngestionService {
  constructor() {
    queueService.registerProcessor(this.processQueuedJob.bind(this));
  }

  /**
   * Main entry point for submitting a document for processing (buffer/small file)
   */
  public async submitDocumentForIngestion(
    filename: string,
    fileBuffer: Buffer,
    mimeType: string,
    options: IngestionOptions = {}
  ): Promise<{ jobId: string; documentId: string }> {
    const documentId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userId = options.userId || 'user-default-admin';

    // Compute SHA-256 Content Hash for duplicate detection
    const contentHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // 1. Save file to persistent storage
    const storedFile = await storageService.saveFile(filename, fileBuffer, mimeType);

    // 2. Determine collection name
    let collectionName: string | undefined;
    if (options.collectionId) {
      const col = await dbService.getCollectionById(options.collectionId, userId);
      if (col) collectionName = col.name;
    }

    const docType = this.determineDocumentType(filename, mimeType);

    // Fast-path: Check for identical duplicate document already indexed for this user
    const existingDuplicate = await dbService.findDocumentByHash(contentHash, userId);
    if (existingDuplicate) {
      const existingChunks = await dbService.getChunksForDocument(existingDuplicate.id, userId);
      if (existingChunks.length > 0) {
        console.log(`[IngestionService] Instant fast-path duplicate detected for user ${userId}. Reusing ${existingChunks.length} chunks from ${existingDuplicate.id}.`);

        const clonedChunks: Chunk[] = existingChunks.map(c => ({
          ...c,
          id: `chk-${documentId}-${c.chunkIndex}`,
          documentId,
          documentTitle: filename,
          userId,
        }));

        keywordService.indexBatch(clonedChunks);
        await dbService.saveChunks(clonedChunks);

        const readyDoc: Document = {
          id: documentId,
          userId,
          title: filename,
          originalName: filename,
          type: docType,
          category: this.determineCategory(docType),
          status: 'READY',
          progress: 100,
          statusMessage: `Successfully indexed (${clonedChunks.length} chunks - Deduplicated Instant Recall)`,
          collectionId: options.collectionId,
          collectionName,
          contentHash,
          chunkCount: clonedChunks.length,
          sizeBytes: fileBuffer.length,
          tags: options.tags || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metrics: {
            parsingTimeMs: 1,
            visualExtractionTimeMs: 0,
            chunkingTimeMs: 0,
            embeddingTimeMs: 0,
            qdrantTimeMs: 0,
            bm25TimeMs: 1,
            databaseTimeMs: 1,
            totalTimeMs: 3,
            embeddingCalls: 0,
            embeddingBatchSize: 0,
            qdrantBatchSize: 0,
            charCount: fileBuffer.length,
            deduplicated: true,
          },
        };

        await dbService.saveDocument(readyDoc);

        if (options.collectionId) {
          const col = await dbService.getCollectionById(options.collectionId, userId);
          if (col) {
            col.documentCount = (col.documentCount || 0) + 1;
            col.updatedAt = new Date().toISOString();
            await dbService.saveCollection(col);
          }
        }

        return { jobId, documentId };
      }
    }

    // 3. Create initial Document record in DB
    const initialDoc: Document = {
      id: documentId,
      userId,
      title: filename,
      originalName: filename,
      type: docType,
      category: this.determineCategory(docType),
      status: 'UPLOADING',
      progress: 10,
      statusMessage: 'File uploaded and queued for processing',
      collectionId: options.collectionId,
      collectionName,
      contentHash,
      chunkCount: 0,
      sizeBytes: fileBuffer.length,
      storagePath: storedFile.storagePath,
      tags: options.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbService.saveDocument(initialDoc);

    // 4. Enqueue background processing job
    await queueService.addIngestionJob({
      jobId,
      userId,
      documentId,
      filename,
      fileType: docType,
      fileSizeBytes: fileBuffer.length,
      storagePath: storedFile.storagePath,
      mimeType,
      collectionId: options.collectionId,
      tags: options.tags,
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
    });

    return { jobId, documentId };
  }

  /**
   * Main entry point for submitting an assembled large file from the resumable streaming upload pipeline
   */
  public async submitAssembledFileForIngestion(
    storedFile: StoredFile,
    options: IngestionOptions = {}
  ): Promise<{ jobId: string; documentId: string }> {
    const documentId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userId = options.userId || 'user-default-admin';
    const contentHash = storedFile.checksum;
    const filename = storedFile.originalName;
    const mimeType = storedFile.mimeType;

    // 1. Determine collection name
    let collectionName: string | undefined;
    if (options.collectionId) {
      const col = await dbService.getCollectionById(options.collectionId, userId);
      if (col) collectionName = col.name;
    }

    const docType = this.determineDocumentType(filename, mimeType);

    // Fast-path: Check for identical duplicate document already indexed for this user
    const existingDuplicate = await dbService.findDocumentByHash(contentHash, userId);
    if (existingDuplicate) {
      const existingChunks = await dbService.getChunksForDocument(existingDuplicate.id, userId);
      if (existingChunks.length > 0) {
        console.log(`[IngestionService] Instant fast-path duplicate detected for user ${userId}. Reusing ${existingChunks.length} chunks from ${existingDuplicate.id}.`);

        const clonedChunks: Chunk[] = existingChunks.map(c => ({
          ...c,
          id: `chk-${documentId}-${c.chunkIndex}`,
          documentId,
          documentTitle: filename,
          userId,
        }));

        keywordService.indexBatch(clonedChunks);
        await dbService.saveChunks(clonedChunks);

        const readyDoc: Document = {
          id: documentId,
          userId,
          title: filename,
          originalName: filename,
          type: docType,
          category: this.determineCategory(docType),
          status: 'READY',
          progress: 100,
          statusMessage: `Successfully indexed (${clonedChunks.length} chunks - Deduplicated Instant Recall)`,
          collectionId: options.collectionId,
          collectionName,
          contentHash,
          chunkCount: clonedChunks.length,
          sizeBytes: storedFile.size,
          storagePath: storedFile.storagePath,
          tags: options.tags || [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          metrics: {
            parsingTimeMs: 1,
            visualExtractionTimeMs: 0,
            chunkingTimeMs: 0,
            embeddingTimeMs: 0,
            qdrantTimeMs: 0,
            bm25TimeMs: 1,
            databaseTimeMs: 1,
            totalTimeMs: 3,
            embeddingCalls: 0,
            embeddingBatchSize: 0,
            qdrantBatchSize: 0,
            charCount: storedFile.size,
            deduplicated: true,
          },
        };

        await dbService.saveDocument(readyDoc);

        if (options.collectionId) {
          const col = await dbService.getCollectionById(options.collectionId, userId);
          if (col) {
            col.documentCount = (col.documentCount || 0) + 1;
            col.updatedAt = new Date().toISOString();
            await dbService.saveCollection(col);
          }
        }

        return { jobId, documentId };
      }
    }

    // 2. Create initial Document record in DB
    const initialDoc: Document = {
      id: documentId,
      userId,
      title: filename,
      originalName: filename,
      type: docType,
      category: this.determineCategory(docType),
      status: 'UPLOADING',
      progress: 10,
      statusMessage: 'File uploaded and queued for processing',
      collectionId: options.collectionId,
      collectionName,
      contentHash,
      chunkCount: 0,
      sizeBytes: storedFile.size,
      storagePath: storedFile.storagePath,
      tags: options.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbService.saveDocument(initialDoc);

    // 3. Enqueue background processing job
    await queueService.addIngestionJob({
      jobId,
      userId,
      documentId,
      filename,
      fileType: docType,
      fileSizeBytes: storedFile.size,
      storagePath: storedFile.storagePath,
      mimeType,
      collectionId: options.collectionId,
      tags: options.tags,
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
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
    const userId = options.userId || 'user-default-admin';

    let collectionName: string | undefined;
    if (options.collectionId) {
      const col = await dbService.getCollectionById(options.collectionId, userId);
      if (col) collectionName = col.name;
    }

    const contentHash = crypto.createHash('sha256').update(url).digest('hex');

    const initialDoc: Document = {
      id: documentId,
      userId,
      title: url,
      originalName: url,
      type: 'URL',
      category: 'Web',
      status: 'UPLOADING',
      progress: 10,
      statusMessage: 'Web URL queued for crawling',
      collectionId: options.collectionId,
      collectionName,
      contentHash,
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
      userId,
      documentId,
      filename: url,
      fileType: 'URL',
      fileSizeBytes: 0,
      url,
      collectionId: options.collectionId,
      tags: options.tags,
      chunkSize: options.chunkSize,
      chunkOverlap: options.chunkOverlap,
    });

    return { jobId, documentId };
  }

  /**
   * Re-run ingestion for a previously failed or existing document
   */
  public async retryDocumentIngestion(
    documentId: string,
    userId = 'user-default-admin'
  ): Promise<{ jobId: string; documentId: string }> {
    const doc = await dbService.getDocumentById(documentId, userId);
    if (!doc) {
      throw new Error(`Document ${documentId} not found`);
    }

    // Clean up partial vectors and chunks first
    await vectorService.deleteDocumentVectors(documentId);
    keywordService.removeDocument(documentId);

    // Reset status
    doc.status = 'UPLOADING';
    doc.progress = 10;
    doc.statusMessage = 'Retrying document indexing...';
    doc.updatedAt = new Date().toISOString();
    await dbService.saveDocument(doc);

    const jobId = `job-retry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await queueService.addIngestionJob({
      jobId,
      userId,
      documentId: doc.id,
      filename: doc.originalName || doc.title,
      fileType: doc.type,
      fileSizeBytes: doc.sizeBytes || 0,
      storagePath: doc.storagePath,
      url: doc.sourceUrl,
      collectionId: doc.collectionId,
      tags: doc.tags,
      chunkSize: 500,
      chunkOverlap: 50,
    });

    return { jobId, documentId: doc.id };
  }

  /**
   * Worker processor executing streaming progressive extraction, adaptive chunking,
   * bounded batch embedding, vector database indexing, and BM25 indexing.
   */
  private async processQueuedJob(
    data: IngestionJobData,
    updateProgress: (progress: number, stage: string) => Promise<void>
  ): Promise<IngestionResult> {
    try {
      const startTime = Date.now();
      const userId = data.userId || 'user-default-admin';

      let parsingTimeMs = 0;
      let visualExtractionTimeMs = 0;
      let chunkingTimeMs = 0;
      let embeddingTimeMs = 0;
      let qdrantTimeMs = 0;
      let bm25TimeMs = 0;
      let databaseTimeMs = 0;

      let totalChunksCreated = 0;
      let totalTokensCreated = 0;
      let totalCharsProcessed = 0;
      let embeddingCallsCount = 0;

      // 1. Resolve source file / path
      let resolvedFilePath: string | null = null;
      let fileSizeBytes = data.fileSizeBytes || 0;
      let contentHash = '';

      if (data.storagePath) {
        resolvedFilePath = storageService.resolveStoragePath(data.storagePath);
        fileSizeBytes = storageService.getFileSize(resolvedFilePath);
        contentHash = await storageService.computeFileChecksumStream(resolvedFilePath);
      } else if (data.url) {
        contentHash = crypto.createHash('sha256').update(data.url).digest('hex');
      } else if (data.content) {
        const contentStr = String(data.content);
        // Write temporary file for memory-safe streaming processing
        const tempPath = `/tmp/temp_content_${data.documentId}_${Date.now()}.txt`;
        if (contentStr.startsWith('data:')) {
          const commaIdx = contentStr.indexOf(',');
          const b64 = commaIdx !== -1 ? contentStr.slice(commaIdx + 1) : contentStr;
          fs.writeFileSync(tempPath, Buffer.from(b64.trim(), 'base64'));
        } else {
          fs.writeFileSync(tempPath, Buffer.from(contentStr, 'utf-8'));
        }
        resolvedFilePath = tempPath;
        fileSizeBytes = fs.statSync(tempPath).size;
        contentHash = crypto.createHash('sha256').update(contentStr).digest('hex');
      }

      // Check for duplicate document already indexed for this user (Tenant Isolation Preserved)
      const existingDuplicate = await dbService.findDocumentByHash(contentHash, userId);
      if (existingDuplicate && existingDuplicate.id !== data.documentId) {
        const existingChunks = await dbService.getChunksForDocument(existingDuplicate.id, userId);
        if (existingChunks.length > 0) {
          console.log(`[IngestionService] Duplicate detected for user ${userId}. Reusing ${existingChunks.length} chunks from ${existingDuplicate.id}.`);
          await updateProgress(90, 'Reusing indexed vector embeddings from duplicate document...');

          const clonedChunks: Chunk[] = existingChunks.map(c => ({
            ...c,
            id: `chk-${data.documentId}-${c.chunkIndex}`,
            documentId: data.documentId,
            documentTitle: data.filename,
            userId,
          }));

          keywordService.indexBatch(clonedChunks);
          await dbService.saveChunks(clonedChunks);

          const doc = await dbService.getDocumentById(data.documentId, userId);
          if (doc) {
            doc.status = 'READY';
            doc.progress = 100;
            doc.chunkCount = clonedChunks.length;
            doc.statusMessage = `Successfully indexed (${clonedChunks.length} chunks - Deduplicated Instant Recall)`;
            doc.updatedAt = new Date().toISOString();
            doc.metrics = {
              parsingTimeMs: 1,
              visualExtractionTimeMs: 0,
              chunkingTimeMs: 0,
              embeddingTimeMs: 0,
              qdrantTimeMs: 0,
              bm25TimeMs: 1,
              databaseTimeMs: 1,
              totalTimeMs: Date.now() - startTime,
              deduplicated: true,
              charCount: fileSizeBytes,
            };
            await dbService.saveDocument(doc);
          }

          const fastJob = await dbService.getJob(data.jobId);
          if (fastJob) {
            fastJob.status = 'READY';
            fastJob.progress = 100;
            fastJob.stepMessage = `Successfully indexed (${clonedChunks.length} chunks - Deduplicated)`;
            fastJob.completedAt = new Date().toISOString();
            fastJob.chunkCount = clonedChunks.length;
            fastJob.pageCount = existingDuplicate.pageCount;
            fastJob.visualElementCount = clonedChunks.filter(c => c.metadata?.isVisual || c.id.includes('-vis-')).length;
            fastJob.metrics = doc?.metrics;
            await dbService.saveJob(fastJob);
          }

          await updateProgress(100, `Successfully indexed ${clonedChunks.length} chunks`);
          return {
            documentId: data.documentId,
            chunksCreated: clonedChunks.length,
            status: 'READY',
            metrics: doc?.metrics,
          };
        }
      }

      const docType = this.determineDocumentType(data.filename, data.mimeType);
      const docTitle = data.filename.replace(/\.[^/.]+$/, '');

      // --- BOUNDED PIPELINE PROCESSING ---
      await updateProgress(25, 'Starting progressive streaming extraction & adaptive chunking...');
      const parseAndChunkStart = Date.now();

      // Bounded Batch Callback: Embed -> Upsert Qdrant -> Index BM25 -> Save Chunks -> Release memory
      const onChunkBatch = async (chunkBatch: Chunk[]) => {
        if (chunkBatch.length === 0) return;

        // 1. Embed batch with Gemini (bounded batch size, exponential backoff for 429)
        const embedStart = Date.now();
        const texts = chunkBatch.map(c => c.content);
        const teleBefore = embeddingService.getTelemetry();
        const vectors = await embeddingService.embedBatch(texts);
        const teleAfter = embeddingService.getTelemetry();
        embeddingTimeMs += (Date.now() - embedStart);
        embeddingCallsCount += (teleAfter.totalEmbeddingsGenerated - teleBefore.totalEmbeddingsGenerated);

        // 2. Qdrant Vector Upsert
        const qdrantStart = Date.now();
        const vectorPoints = chunkBatch.map((chunk, idx) => ({
          id: `${chunk.documentId}_${chunk.chunkIndex}`,
          vector: vectors[idx],
          payload: {
            chunkId: chunk.id,
            documentId: chunk.documentId,
            content: chunk.content,
            title: chunk.documentTitle,
            type: docType,
            pageNumber: chunk.pageNumber,
            slideNumber: chunk.slideNumber,
            sectionHeader: chunk.sectionHeader,
            collectionId: data.collectionId,
            sourceUrl: data.url,
            chunkIndex: chunk.chunkIndex,
            userId,
          },
        }));
        await vectorService.upsertChunkVectors(vectorPoints);
        qdrantTimeMs += (Date.now() - qdrantStart);

        // 3. BM25 Inverted Index Update
        const bm25Start = Date.now();
        keywordService.indexBatch(chunkBatch);
        bm25TimeMs += (Date.now() - bm25Start);

        // 4. Save Chunk batch into Database
        const dbStart = Date.now();
        await dbService.saveChunks(chunkBatch);
        databaseTimeMs += (Date.now() - dbStart);

        totalChunksCreated += chunkBatch.length;
        totalTokensCreated += chunkBatch.reduce((sum, c) => sum + c.tokenCount, 0);

        const dynamicProgress = Math.min(88, 30 + Math.floor((totalChunksCreated / Math.max(1, totalChunksCreated + 20)) * 55));
        await updateProgress(dynamicProgress, `Indexed ${totalChunksCreated} chunks (${totalTokensCreated} tokens)...`);
      };

      let parseSummary: StreamParseSummary;

      if (data.url) {
        // Handle URL fetching
        const urlDoc = await DocumentParserService.parseUrl(data.url);
        parseSummary = await StreamingDocumentParser.processNormalizedSectionsProgressive(
          urlDoc.sections,
          undefined,
          {
            documentId: data.documentId,
            documentTitle: urlDoc.title,
            documentType: 'URL',
            fileSizeBytes: urlDoc.rawText.length,
            userId,
            customChunkSize: data.chunkSize,
            customChunkOverlap: data.chunkOverlap,
            onChunkBatch,
          },
          StreamingDocumentParser.getAdaptiveConfig(urlDoc.rawText.length, data.chunkSize, data.chunkOverlap)
        );
      } else if (resolvedFilePath) {
        // Progressive file streaming
        parseSummary = await StreamingDocumentParser.parseAndChunkFileStream(resolvedFilePath, {
          documentId: data.documentId,
          documentTitle: docTitle,
          documentType: docType,
          fileSizeBytes,
          userId,
          customChunkSize: data.chunkSize,
          customChunkOverlap: data.chunkOverlap,
          onChunkBatch,
        });
      } else {
        throw new Error('No source content or storage path provided for ingestion.');
      }

      parsingTimeMs = Math.floor((Date.now() - parseAndChunkStart) * 0.4);
      chunkingTimeMs = Math.floor((Date.now() - parseAndChunkStart) * 0.6);
      totalCharsProcessed = parseSummary.totalChars || fileSizeBytes;

      // STAGE 3: Multimodal Visual Extraction for PDFs (if applicable)
      let visualChunksCount = 0;
      if (docType === 'PDF' && resolvedFilePath) {
        await updateProgress(90, 'Extracting multimodal visual evidence and charts...');
        const visStart = Date.now();
        try {
          const visualResult = await visualEvidenceService.extractPdfVisualEvidence(
            data.documentId,
            docTitle,
            resolvedFilePath,
            totalChunksCreated
          );
          if (visualResult.chunks && visualResult.chunks.length > 0) {
            visualChunksCount = visualResult.chunks.length;
            await onChunkBatch(visualResult.chunks);
            console.log(`[IngestionService] Extracted ${visualResult.figures.length} visual figures (${visualResult.chunks.length} chunks) for doc ${data.documentId}`);
          }
        } catch (visErr: any) {
          console.warn(`[IngestionService] Visual evidence extraction warning (non-fatal): ${visErr.message}`);
        }
        visualExtractionTimeMs = Date.now() - visStart;
      }

      if (totalChunksCreated === 0) {
        throw new Error('No readable text content or visual evidence could be extracted from document.');
      }

      // Flush database snapshot once at the end of ingestion
      dbService.saveSnapshot(true);

      const totalTimeMs = Date.now() - startTime;
      const metrics: DocumentMetrics = {
        parsingTimeMs,
        visualExtractionTimeMs,
        chunkingTimeMs,
        embeddingTimeMs,
        qdrantTimeMs,
        bm25TimeMs,
        databaseTimeMs,
        totalTimeMs,
        embeddingCalls: embeddingCallsCount,
        embeddingBatchSize: 50,
        qdrantBatchSize: 100,
        charCount: totalCharsProcessed,
        deduplicated: false,
      };

      // STAGE 4: Finalize Document Record
      const doc = await dbService.getDocumentById(data.documentId, userId);
      if (doc) {
        doc.title = docTitle;
        doc.type = docType;
        doc.category = this.determineCategory(docType);
        doc.pageCount = parseSummary.pageCount;
        doc.slideCount = parseSummary.slideCount;
        doc.sectionCount = parseSummary.totalChunks;
        doc.chunkCount = totalChunksCreated;
        doc.contentHash = contentHash;
        doc.sizeBytes = fileSizeBytes;
        doc.summary = parseSummary.summary;
        doc.contentPreview = parseSummary.contentPreview;
        doc.status = 'READY';
        doc.progress = 100;
        doc.statusMessage = `Successfully indexed (${totalChunksCreated} adaptive chunks)`;
        doc.userId = userId;
        doc.updatedAt = new Date().toISOString();
        doc.metrics = metrics;
        await dbService.saveDocument(doc);
      }

      // Update Collection doc count
      if (data.collectionId) {
        const col = await dbService.getCollectionById(data.collectionId, userId);
        if (col) {
          col.documentCount = (col.documentCount || 0) + 1;
          col.updatedAt = new Date().toISOString();
          await dbService.saveCollection(col);
        }
      }

      // STAGE 5: Log Notification & Activity
      dbService.addActivity({
        id: `act-${Date.now()}`,
        userId,
        type: 'index_complete',
        title: 'Document Ingestion Complete',
        description: `Indexed ${totalChunksCreated} chunks into Qdrant & BM25 (${Math.round(totalTimeMs)}ms)`,
        timestamp: new Date().toISOString(),
        documentId: data.documentId,
      });

      dbService.addNotification({
        id: `notif-ready-${data.documentId}`,
        userId,
        type: 'SUCCESS',
        title: 'Document Ready',
        message: visualChunksCount > 0
          ? `${docTitle} indexed with visual evidence & charts.`
          : `${docTitle} has been indexed successfully.`,
        timestamp: new Date().toISOString(),
        read: false,
        documentId: data.documentId,
        linkTab: 'knowledge',
      });

      const finalJob = await dbService.getJob(data.jobId);
      if (finalJob) {
        finalJob.status = 'READY';
        finalJob.progress = 100;
        finalJob.stepMessage = `Successfully indexed ${totalChunksCreated} chunks`;
        finalJob.completedAt = new Date().toISOString();
        finalJob.chunkCount = totalChunksCreated;
        finalJob.pageCount = parseSummary.pageCount;
        finalJob.visualElementCount = visualChunksCount;
        finalJob.metrics = metrics;
        await dbService.saveJob(finalJob);
      }

      await updateProgress(100, `Successfully indexed ${totalChunksCreated} chunks (${totalTokensCreated} tokens) in ${Math.round(totalTimeMs)}ms`);

      return {
        documentId: data.documentId,
        chunksCreated: totalChunksCreated,
        status: 'READY',
        metrics,
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

      dbService.addNotification({
        id: `notif-failed-${data.documentId}`,
        type: 'ERROR',
        title: 'Document Processing Failed',
        message: `${data.filename || 'Document'} could not be indexed.`,
        timestamp: new Date().toISOString(),
        read: false,
        documentId: data.documentId,
        linkTab: 'knowledge',
      });

      throw err;
    }
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
