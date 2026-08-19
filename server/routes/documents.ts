import { Router, Request, Response } from 'express';
import multer from 'multer';
import { dbService } from '../db/database';
import { ingestionService } from '../services/ingestion-service';
import { vectorService } from '../services/vector-service';
import { keywordService } from '../services/keyword-service';
import { optionalAuth } from '../middleware/auth';
import { DocumentType, DocumentStatus, DocumentCategory } from '../../src/types';

export const documentsRouter = Router();

// Enable user context resolution
documentsRouter.use(optionalAuth);

const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  storage: multer.memoryStorage(),
});

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
      status: doc.status,
      progress: doc.progress,
      statusMessage: doc.statusMessage,
      chunkCount: doc.chunkCount,
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

// POST /api/documents/upload
documentsRouter.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
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
