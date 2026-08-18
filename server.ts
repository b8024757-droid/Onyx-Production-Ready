/**
 * Second Brain — Full-Stack Server Entry Point
 * Express API backend + Vite development middleware / production static server
 */

import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { dbService } from './server/db/database';
import { vectorService } from './server/services/vector-service';
import { keywordService } from './server/services/keyword-service';
import { documentsRouter } from './server/routes/documents';
import { collectionsRouter } from './server/routes/collections';
import { searchRouter } from './server/routes/search';
import { chatRouter } from './server/routes/chat';
import { statsRouter } from './server/routes/stats';
import { authRouter } from './server/routes/auth';
import { setupRouter } from './server/routes/setup';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // JSON & URL-encoded request body parsing (supporting rich documents up to 50MB)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API Routes
  app.use('/api/auth', authRouter);
  app.use('/api/setup', setupRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/collections', collectionsRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/conversations', chatRouter);
  app.use('/api', statsRouter);

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'Second Brain Knowledge Engine',
      version: '2.0.0-production',
      timestamp: new Date().toISOString(),
    });
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start listening immediately on Port 3000
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🧠 Second Brain server running at http://0.0.0.0:${PORT}`);
  });

  // Initialize DB, Vector, and Keyword services in background
  (async () => {
    try {
      await dbService.init();
      await vectorService.init();
      await keywordService.rebuildIndex();
      const existingChunks = await dbService.getAllChunks();
      await vectorService.syncChunks(existingChunks);
      console.log('✅ Background data stores and vector index initialized.');
    } catch (initErr) {
      console.warn('⚠️ Non-fatal warning during background store sync:', initErr);
    }
  })();

  return server;
}

startServer().catch(err => {
  console.error('Failed to start Second Brain server:', err);
  process.exit(1);
});

