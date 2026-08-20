import crypto from 'crypto';
import { dbService } from '../db/database';
import { DocumentParserService, NormalizedDocument, NormalizedSection } from '../parsers';
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

    // Fast-path: Check for identical duplicate document already indexed for this user (Tenant Isolation Preserved)
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
      chunkSize: options.chunkSize || 500,
      chunkOverlap: options.chunkOverlap || 50,
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

    // Fast-path: Check for identical duplicate document already indexed for this user (Tenant Isolation Preserved)
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
      chunkSize: options.chunkSize || 500,
      chunkOverlap: options.chunkOverlap || 50,
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
   * Worker processor executing full extraction, chunking, embedding, and indexing pipeline
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

      // Calculate content hash for deduplication
      const contentHash = rawFileBuffer
        ? crypto.createHash('sha256').update(rawFileBuffer).digest('hex')
        : crypto.createHash('sha256').update(parsedDoc.rawText || data.url || '').digest('hex');

      // Update document record with title and metadata
      const doc = await dbService.getDocumentById(data.documentId, userId);
      if (doc) {
        doc.title = parsedDoc.title || data.filename || data.url || 'Document';
        doc.type = parsedDoc.documentType;
        doc.category = this.determineCategory(parsedDoc.documentType);
        doc.pageCount = parsedDoc.pageCount;
        doc.slideCount = parsedDoc.slideCount;
        doc.sectionCount = parsedDoc.sections.length;
        doc.contentHash = contentHash;
        doc.summary = parsedDoc.sections[0]?.content.slice(0, 200);
        doc.contentPreview = parsedDoc.sections.slice(0, 3).map(s => s.content).join('\n\n').slice(0, 500);
        await dbService.saveDocument(doc);
      }

      // Check for identical duplicate document already indexed for this user (Tenant Isolation Preserved)
      const existingDuplicate = await dbService.findDocumentByHash(contentHash, userId);
      if (existingDuplicate && existingDuplicate.id !== data.documentId) {
        const existingChunks = await dbService.getChunksForDocument(existingDuplicate.id, userId);
        if (existingChunks.length > 0) {
          console.log(`[IngestionService] Duplicate detected for user ${userId}. Reusing ${existingChunks.length} chunks from ${existingDuplicate.id}.`);
          await updateProgress(90, 'Reusing indexed vector embeddings from duplicate document...');

          // Clone chunks for this document ID
          const clonedChunks: Chunk[] = existingChunks.map(c => ({
            ...c,
            id: `chk-${data.documentId}-${c.chunkIndex}`,
            documentId: data.documentId,
            documentTitle: doc?.title || parsedDoc.title,
            userId,
          }));

          // Index into keyword search and database
          keywordService.indexBatch(clonedChunks);
          await dbService.saveChunks(clonedChunks);

          // Update doc status
          if (doc) {
            doc.status = 'READY';
            doc.progress = 100;
            doc.chunkCount = clonedChunks.length;
            doc.statusMessage = `Successfully indexed (${clonedChunks.length} chunks - Deduplicated Instant Recall)`;
            doc.updatedAt = new Date().toISOString();
            doc.metrics = {
              parsingTimeMs,
              chunkingTimeMs: 0,
              embeddingTimeMs: 0,
              qdrantTimeMs: 0,
              bm25TimeMs: 1,
              databaseTimeMs: 1,
              totalTimeMs: Date.now() - startTime,
              deduplicated: true,
              charCount: parsedDoc.rawText.length,
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
            fastJob.pageCount = existingDuplicate.pageCount || parsedDoc.pageCount;
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

      // --- STAGE 2: STRUCTURE-AWARE CHUNKING & MULTIMODAL EXTRACTION ---
      await updateProgress(50, 'Segmenting text into structure-aware semantic chunks');
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
      chunkingTimeMs = Date.now() - chunkStart;

      // Multimodal Visual Evidence Extraction for PDFs
      if (parsedDoc.documentType === 'PDF' && rawFileBuffer) {
        const visStart = Date.now();
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
        visualExtractionTimeMs = Date.now() - visStart;
      }

      if (chunks.length === 0) {
        throw new Error('No readable text content or visual evidence extracted from document.');
      }

      // --- STAGE 3: EMBEDDING ---
      await updateProgress(75, `Generating embeddings for ${chunks.length} chunks via Gemini (${embeddingService.getModelName()})`);
      const embedStart = Date.now();

      const chunkTexts = chunks.map(c => c.content);
      const teleBefore = embeddingService.getTelemetry();
      const vectors = await embeddingService.embedBatch(chunkTexts);
      const teleAfter = embeddingService.getTelemetry();
      embeddingTimeMs = Date.now() - embedStart;

      const vectorPoints = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        chunk.userId = userId;
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
            userId,
          },
        });
      }

      // --- STAGE 4: INDEXING (Vector DB + BM25 + PostgreSQL) ---
      await updateProgress(90, 'Upserting vectors into Qdrant and building BM25 index');

      // 1. Upsert vectors to Qdrant
      const qdrantStart = Date.now();
      await vectorService.upsertChunkVectors(vectorPoints);
      qdrantTimeMs = Date.now() - qdrantStart;

      // 2. Index in BM25
      const bm25Start = Date.now();
      keywordService.indexBatch(chunks);
      bm25TimeMs = Date.now() - bm25Start;

      // 3. Save chunks in DB
      const dbStart = Date.now();
      await dbService.saveChunks(chunks);
      databaseTimeMs = Date.now() - dbStart;

      // 4. Update Document record
      const totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);
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
        embeddingCalls: teleAfter.totalEmbeddingsGenerated - teleBefore.totalEmbeddingsGenerated,
        embeddingBatchSize: teleAfter.batchSize,
        qdrantBatchSize: 100,
        charCount: parsedDoc.rawText.length,
        deduplicated: false,
      };

      if (doc) {
        doc.status = 'READY';
        doc.progress = 100;
        doc.statusMessage = `Successfully indexed (${chunks.length} chunks)`;
        doc.chunkCount = chunks.length;
        doc.userId = userId;
        doc.updatedAt = new Date().toISOString();
        doc.metrics = metrics;
        await dbService.saveDocument(doc);
      }

      // 5. Update collection document count
      if (data.collectionId) {
        const col = await dbService.getCollectionById(data.collectionId, userId);
        if (col) {
          col.documentCount = (col.documentCount || 0) + 1;
          col.updatedAt = new Date().toISOString();
          await dbService.saveCollection(col);
        }
      }

      // --- STAGE 5: READY ---
      await updateProgress(100, `Successfully indexed ${chunks.length} chunks (${totalTokens} tokens) in ${Math.round(totalTimeMs)}ms`);

      // Log Activity
      dbService.addActivity({
        id: `act-${Date.now()}`,
        userId,
        type: 'index_complete',
        title: 'Document Ingestion Complete',
        description: `Indexed ${chunks.length} chunks into Qdrant & BM25 (${Math.round(totalTimeMs)}ms)`,
        timestamp: new Date().toISOString(),
        documentId: data.documentId,
      });

      // Application Notification: Ready
      const docName = doc?.title || data.filename || 'Document';
      const isMultimodal = chunks.some(c => c.metadata?.isVisual || c.id.includes('-vis-'));
      dbService.addNotification({
        id: `notif-ready-${data.documentId}`,
        userId,
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

      const finalJob = await dbService.getJob(data.jobId);
      if (finalJob) {
        finalJob.status = 'READY';
        finalJob.progress = 100;
        finalJob.stepMessage = `Successfully indexed ${chunks.length} chunks`;
        finalJob.completedAt = new Date().toISOString();
        finalJob.chunkCount = chunks.length;
        finalJob.pageCount = parsedDoc.pageCount;
        finalJob.visualElementCount = chunks.filter(c => c.metadata?.isVisual || c.id.includes('-vis-')).length;
        finalJob.metrics = metrics;
        await dbService.saveJob(finalJob);
      }

      return {
        documentId: data.documentId,
        chunksCreated: chunks.length,
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
