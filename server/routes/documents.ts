import { Router, Request, Response } from 'express';
import multer from 'multer';
import { dbService } from '../db/database';
import { ingestionService } from '../services/ingestion-service';
import { vectorService } from '../services/vector-service';
import { keywordService } from '../services/keyword-service';
import { storageService } from '../storage/storage-service';
import { optionalAuth } from '../middleware/auth';
import { DocumentType, DocumentStatus, DocumentCategory } from '../../src/types';
import { config } from '../config';

export const documentsRouter = Router();

// Enable user context resolution
documentsRouter.use(optionalAuth);

// Multer for legacy small-file single uploads (< 50MB)
const legacyUpload = multer({
  limits: { fileSize: 50 * 1024 * 1024 },
  storage: multer.memoryStorage(),
});

// Multer for chunk uploads (each chunk is typically 5MB to 10MB, cap at 50MB)
const chunkUpload = multer({
  limits: { fileSize: 50 * 1024 * 1024 },
  storage: multer.memoryStorage(),
});

// =========================================================================
// CHUNKED RESUMABLE STREAMING UPLOAD ENDPOINTS (For Large Files up to 500MB)
// =========================================================================

/**
 * 1. POST /api/documents/upload/init
 * Initializes a resumable upload session.
 */
documentsRouter.post('/upload/init', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const {
      filename,
      sizeBytes,
      mimeType,
      chunkSize,
      clientSha256,
      collectionId,
      tags,
    } = req.body || {};

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ error: 'Valid filename is required.' });
    }

    const numericSize = parseInt(sizeBytes, 10);
    if (isNaN(numericSize) || numericSize <= 0) {
      return res.status(400).json({ error: 'Valid positive sizeBytes is required.' });
    }

    if (numericSize > config.upload.maxFileSizeBytes) {
      return res.status(413).json({
        error: `File size (${(numericSize / 1024 / 1024).toFixed(1)} MB) exceeds the maximum allowed limit of ${config.upload.maxFileSizeMb} MB.`,
      });
    }

    const session = await storageService.initUploadSession({
      filename: filename.trim(),
      sizeBytes: numericSize,
      mimeType: mimeType || 'application/octet-stream',
      chunkSize: chunkSize ? parseInt(chunkSize, 10) : config.upload.chunkSizeBytes,
      clientSha256: clientSha256 ? String(clientSha256).trim() : undefined,
      collectionId,
      tags: Array.isArray(tags) ? tags : undefined,
      userId,
    });

    res.status(201).json({
      uploadId: session.uploadId,
      filename: session.filename,
      sizeBytes: session.sizeBytes,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      maxFileSizeBytes: config.upload.maxFileSizeBytes,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (err: any) {
    console.error('[UploadInit] Error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to initialize upload session.' });
  }
});

/**
 * 2. POST /api/documents/upload/chunk or POST /api/documents/upload/:uploadId/chunk
 * Accepts binary chunk slices streamed directly to disk (Zero RAM).
 */
const handleChunkUpload = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const uploadId = (req.params.uploadId || req.headers['x-upload-id'] || req.body?.uploadId || req.query.uploadId) as string;
    const rawChunkIndex = req.headers['x-chunk-index'] || req.body?.chunkIndex || req.query.chunkIndex;
    const clientChunkSha256 = (req.headers['x-chunk-sha256'] || req.body?.chunkSha256 || req.query.chunkSha256) as string | undefined;

    if (!uploadId) {
      return res.status(400).json({ error: 'Missing uploadId in request parameter or x-upload-id header.' });
    }

    if (rawChunkIndex === undefined || rawChunkIndex === null) {
      return res.status(400).json({ error: 'Missing chunkIndex in request header (x-chunk-index) or body.' });
    }

    const chunkIndex = parseInt(String(rawChunkIndex), 10);
    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ error: 'Invalid chunkIndex. Must be a non-negative integer.' });
    }

    const session = storageService.getUploadSession(uploadId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found, expired, or access denied.' });
    }

    let chunkResult: { chunkIndex: number; size: number; sha256: string; isComplete: boolean };

    // Case A: Multipart Form Data
    if (req.file) {
      chunkResult = await storageService.saveChunkBuffer(
        uploadId,
        userId,
        chunkIndex,
        req.file.buffer,
        clientChunkSha256
      );
    }
    // Case B: Raw Octet Stream
    else if (req.headers['content-type']?.includes('application/octet-stream') || req.is('application/octet-stream')) {
      chunkResult = await storageService.saveChunkStream(
        uploadId,
        userId,
        chunkIndex,
        req,
        clientChunkSha256
      );
    }
    // Case C: Buffer in Body (if parsed by body parser)
    else if (Buffer.isBuffer(req.body)) {
      chunkResult = await storageService.saveChunkBuffer(
        uploadId,
        userId,
        chunkIndex,
        req.body,
        clientChunkSha256
      );
    }
    // Case D: Base64 chunk string
    else if (req.body?.chunkData) {
      const buf = Buffer.from(req.body.chunkData, 'base64');
      chunkResult = await storageService.saveChunkBuffer(
        uploadId,
        userId,
        chunkIndex,
        buf,
        clientChunkSha256
      );
    }
    // Fallback stream
    else {
      chunkResult = await storageService.saveChunkStream(
        uploadId,
        userId,
        chunkIndex,
        req,
        clientChunkSha256
      );
    }

    res.status(200).json({
      uploadId,
      chunkIndex: chunkResult.chunkIndex,
      size: chunkResult.size,
      sha256: chunkResult.sha256,
      uploadedBytes: session.uploadedBytes,
      totalChunks: session.totalChunks,
      completedChunksCount: session.completedChunks.length,
      isComplete: chunkResult.isComplete,
    });
  } catch (err: any) {
    console.error('[ChunkUpload] Error:', err.message);
    res.status(400).json({ error: err.message || 'Chunk upload failed.' });
  }
};

documentsRouter.post('/upload/chunk', chunkUpload.single('chunk'), handleChunkUpload);
documentsRouter.post('/upload/:uploadId/chunk', chunkUpload.single('chunk'), handleChunkUpload);

/**
 * 3. GET /api/documents/upload/:uploadId/status
 * Queries active upload session status and list of received chunks for resumption.
 */
documentsRouter.get('/upload/:uploadId/status', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { uploadId } = req.params;

    const session = storageService.getUploadSession(uploadId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found, expired, or access denied.' });
    }

    const isComplete = session.completedChunks.length === session.totalChunks;

    res.json({
      uploadId: session.uploadId,
      filename: session.filename,
      mimeType: session.mimeType,
      sizeBytes: session.sizeBytes,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedBytes: session.uploadedBytes,
      completedChunks: session.completedChunks,
      isComplete,
      expiresAt: session.expiresAt.toISOString(),
      status: isComplete ? 'READY_TO_ASSEMBLE' : 'UPLOADING',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get upload status.' });
  }
});

/**
 * 4. POST /api/documents/upload/:uploadId/complete
 * Assembles all chunks on disk with streaming SHA-256 verification and passes file to ingestion.
 */
documentsRouter.post('/upload/:uploadId/complete', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { uploadId } = req.params;

    const session = storageService.getUploadSession(uploadId, userId);
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found, expired, or access denied.' });
    }

    // Zero-RAM streaming assembly of chunks on disk
    const { storedFile } = await storageService.assembleUpload(uploadId, userId);

    // Pass assembled file into existing ONYX ingestion pipeline
    const ingestionResult = await ingestionService.submitAssembledFileForIngestion(storedFile, {
      userId,
      collectionId: session.collectionId,
      tags: session.tags,
    });

    session.finalDocumentId = ingestionResult.documentId;
    session.finalJobId = ingestionResult.jobId;

    res.status(202).json({
      message: 'Document ingestion job accepted and queued for background processing',
      uploadId: session.uploadId,
      jobId: ingestionResult.jobId,
      documentId: ingestionResult.documentId,
      contentHash: storedFile.checksum,
      sizeBytes: storedFile.size,
    });
  } catch (err: any) {
    console.error('[UploadComplete] Error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to complete and assemble upload.' });
  }
});

/**
 * 5. POST /api/documents/upload/:uploadId/abort
 * Aborts an upload session and cleans up temporary chunk files.
 */
documentsRouter.post('/upload/:uploadId/abort', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { uploadId } = req.params;

    await storageService.abortUpload(uploadId, userId);
    res.json({ success: true, message: 'Upload session aborted and temporary files cleaned up.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to abort upload session.' });
  }
});

// =========================================================================
// STANDARD / LEGACY DOCUMENT MANAGEMENT ENDPOINTS
// =========================================================================

// GET /api/documents
documentsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { category, search, collectionId, type, status } = req.query;

    let docs = await dbService.getDocuments(userId, {
      collectionId: collectionId as string,
      type: type as DocumentType,
      status: status as DocumentStatus,
      category: category as DocumentCategory,
    });

    if (search) {
      const q = (search as string).toLowerCase();
      docs = docs.filter(d => d.title.toLowerCase().includes(q));
    }

    res.json({ documents: docs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id
documentsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const doc = await dbService.getDocumentById(req.params.id, userId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const chunks = await dbService.getChunksForDocument(doc.id, userId);
    res.json({ document: doc, chunks });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id/status
documentsRouter.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const doc = await dbService.getDocumentById(req.params.id, userId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json({
      id: doc.id,
      title: doc.title,
      type: doc.type,
      status: doc.status,
      progress: doc.progress,
      statusMessage: doc.statusMessage,
      chunkCount: doc.chunkCount,
      pageCount: doc.pageCount,
      slideCount: doc.slideCount,
      sectionCount: doc.sectionCount,
      sizeBytes: doc.sizeBytes,
      metrics: doc.metrics,
      updatedAt: doc.updatedAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id/metrics
documentsRouter.get('/:id/metrics', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const doc = await dbService.getDocumentById(req.params.id, userId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json({
      documentId: doc.id,
      title: doc.title,
      type: doc.type,
      status: doc.status,
      metrics: doc.metrics || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/:id/retry
documentsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const doc = await dbService.getDocumentById(req.params.id, userId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    const result = await ingestionService.retryDocumentIngestion(doc.id, userId);
    res.json({
      message: 'Document indexing retry queued',
      jobId: result.jobId,
      documentId: result.documentId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/upload (Legacy & Small files)
documentsRouter.post('/upload', (req: Request, res: Response, next) => {
  legacyUpload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          error: `File exceeds 50 MB limit for direct upload. For larger files (up to ${config.upload.maxFileSizeMb} MB), please use the chunked resumable upload API (/api/documents/upload/init).`,
        });
      }
      return res.status(400).json({ error: err.message || 'File upload error' });
    }
    next();
  });
}, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const file = req.file;
    const body = req.body || {};

    let filename = body.name || body.filename;
    let buffer: Buffer;
    let mimeType = body.mimeType || 'text/plain';

    if (file) {
      filename = file.originalname;
      buffer = file.buffer;
      mimeType = file.mimetype;
    } else if (body.content) {
      filename = filename || 'document.txt';
      const contentStr = String(body.content);
      if (contentStr.startsWith('data:')) {
        const mimeMatch = contentStr.match(/^data:([^;,]+)(?:;[^,]*)?,/);
        if (mimeMatch && mimeMatch[1]) {
          mimeType = mimeMatch[1].trim();
        }
        const commaIdx = contentStr.indexOf(',');
        const b64Data = commaIdx !== -1 ? contentStr.slice(commaIdx + 1) : contentStr;
        buffer = Buffer.from(b64Data.trim(), 'base64');
      } else if (body.isBase64 || body.encoding === 'base64') {
        buffer = Buffer.from(contentStr.trim(), 'base64');
      } else {
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const isBinaryExt = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'png', 'jpg', 'jpeg'].includes(ext);
        if (isBinaryExt && (contentStr.startsWith('JVBERi0') || /^[A-Za-z0-9+/=]{100,}$/.test(contentStr.replace(/\s+/g, '')))) {
          buffer = Buffer.from(contentStr.trim(), 'base64');
        } else {
          buffer = Buffer.from(contentStr, 'utf-8');
        }
      }

      // Ensure mimeType aligns with extension if generic or missing
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      if (ext === 'pdf' && (!mimeType || mimeType === 'text/plain' || mimeType === 'application/octet-stream')) {
        mimeType = 'application/pdf';
      } else if (ext === 'docx' && (!mimeType || mimeType === 'text/plain')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      } else if (ext === 'pptx' && (!mimeType || mimeType === 'text/plain')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      } else if (ext === 'xlsx' && (!mimeType || mimeType === 'text/plain')) {
        mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      }
    } else if (body.url || body.sourceUrl) {
      const targetUrl = body.url || body.sourceUrl;
      const result = await ingestionService.submitUrlForIngestion(targetUrl, {
        userId,
        collectionId: body.collectionId,
        tags: body.tags,
        chunkSize: body.chunkSize ? parseInt(body.chunkSize, 10) : undefined,
        chunkOverlap: body.chunkOverlap ? parseInt(body.chunkOverlap, 10) : undefined,
      });
      return res.status(202).json({
        message: 'URL ingestion job accepted and processing in background',
        jobId: result.jobId,
        documentId: result.documentId,
      });
    } else {
      return res.status(400).json({ error: 'No file, content, or URL provided for ingestion' });
    }

    const result = await ingestionService.submitDocumentForIngestion(filename, buffer, mimeType, {
      userId,
      collectionId: body.collectionId,
      tags: body.tags,
      chunkSize: body.chunkSize ? parseInt(body.chunkSize, 10) : undefined,
      chunkOverlap: body.chunkOverlap ? parseInt(body.chunkOverlap, 10) : undefined,
    });

    res.status(202).json({
      message: 'Document ingestion job accepted and queued for background processing',
      jobId: result.jobId,
      documentId: result.documentId,
    });
  } catch (err: any) {
    console.error('[UploadRoute] Error:', err);
    res.status(500).json({ error: err.message || 'Upload processing failed' });
  }
});

// POST /api/documents/url
documentsRouter.post('/url', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { url, collectionId, tags, chunkSize, chunkOverlap } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const result = await ingestionService.submitUrlForIngestion(url, {
      userId,
      collectionId,
      tags,
      chunkSize,
      chunkOverlap,
    });

    res.status(202).json({
      message: 'URL ingestion job queued for real server-side fetch & indexing',
      jobId: result.jobId,
      documentId: result.documentId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'URL ingestion failed' });
  }
});

// DELETE /api/documents/:id
documentsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { id } = req.params;
    const doc = await dbService.getDocumentById(id, userId);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await vectorService.deleteDocumentVectors(id);
    keywordService.removeDocument(id);
    await dbService.deleteDocument(id, userId);

    dbService.addActivity({
      id: `act-${Date.now()}`,
      userId,
      type: 'source_added',
      title: 'Document Removed',
      description: `Removed "${doc.title}" and its vectors from knowledge store`,
      timestamp: new Date().toISOString(),
      documentId: doc.id,
    });

    res.json({ success: true, message: `Document ${id} successfully deleted` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
