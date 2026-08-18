/**
 * Second Brain — Infrastructure Setup & Credential Verification Routes
 * Secure AES-256 encrypted credential storage and live service verification for
 * Google Gemini API, Qdrant Vector Cluster, and PostgreSQL Database.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { QdrantClient } from '@qdrant/js-client-rest';
import { GoogleGenAI } from '@google/genai';
import { dbService, UserCredentials } from '../db/database';
import { CryptoService } from '../services/crypto-service';
import { requireAuth } from '../middleware/auth';
import { SetupStatus } from '../../src/types';

export const setupRouter = Router();

// All setup routes require authentication
setupRouter.use(requireAuth);

function formatSetupStatus(userId: string, creds: UserCredentials | null): SetupStatus {
  return {
    userId,
    geminiConnected: creds?.geminiVerified || false,
    geminiMasked: creds?.geminiApiKeyMasked,
    qdrantConnected: creds?.qdrantVerified || false,
    qdrantUrlMasked: creds?.qdrantUrlMasked,
    postgresConnected: creds?.postgresVerified || false,
    postgresUrlMasked: creds?.postgresUrlMasked,
    setupCompleted: creds?.setupCompleted || false,
    currentSetupStep: creds?.currentSetupStep || 'gemini',
  };
}

// GET /api/setup/status
setupRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    let creds = await dbService.getUserCredentials(userId);
    if (!creds) {
      creds = {
        userId,
        geminiVerified: false,
        qdrantVerified: false,
        postgresVerified: false,
        setupCompleted: false,
        currentSetupStep: 'gemini',
        updatedAt: new Date().toISOString(),
      };
      await dbService.saveUserCredentials(creds);
    }
    res.json({ setupStatus: formatSetupStatus(userId, creds) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/setup/gemini
setupRouter.post('/gemini', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { apiKey, skip } = req.body;

    let creds = (await dbService.getUserCredentials(userId)) || {
      userId,
      geminiVerified: false,
      qdrantVerified: false,
      postgresVerified: false,
      setupCompleted: false,
      currentSetupStep: 'gemini',
      updatedAt: new Date().toISOString(),
    };

    if (skip) {
      creds.currentSetupStep = 'qdrant';
      creds.updatedAt = new Date().toISOString();
      await dbService.saveUserCredentials(creds);
      return res.json({
        success: true,
        message: 'Gemini setup skipped. Default fallback model environment will be used if configured.',
        setupStatus: formatSetupStatus(userId, creds),
      });
    }

    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return res.status(400).json({ error: 'Valid Gemini API key is required' });
    }

    const trimmedKey = apiKey.trim();

    // Verify key with live Gemini API ping
    try {
      const ai = new GoogleGenAI({ apiKey: trimmedKey });
      // Use countTokens as a lightweight verification endpoint
      await ai.models.countTokens({
        model: 'gemini-2.5-flash',
        contents: 'ping',
      });
    } catch (testErr: any) {
      return res.status(400).json({
        error: `Gemini verification failed: ${testErr.message || 'Invalid API Key'}. Please check your key permissions.`,
      });
    }

    // Encrypt sensitive API key
    const encrypted = CryptoService.encryptSecret(trimmedKey);
    creds.geminiApiKeyEncrypted = encrypted.encrypted;
    creds.geminiApiKeyIv = encrypted.iv;
    creds.geminiApiKeyTag = encrypted.tag;
    creds.geminiApiKeyMasked = CryptoService.maskSecret(trimmedKey);
    creds.geminiVerified = true;
    creds.currentSetupStep = 'qdrant';
    creds.updatedAt = new Date().toISOString();

    await dbService.saveUserCredentials(creds);

    res.json({
      success: true,
      message: 'Google Gemini API key verified and encrypted successfully.',
      setupStatus: formatSetupStatus(userId, creds),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/setup/qdrant
setupRouter.post('/qdrant', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { url, apiKey, skip } = req.body;

    let creds = (await dbService.getUserCredentials(userId)) || {
      userId,
      geminiVerified: false,
      qdrantVerified: false,
      postgresVerified: false,
      setupCompleted: false,
      currentSetupStep: 'qdrant',
      updatedAt: new Date().toISOString(),
    };

    if (skip) {
      creds.currentSetupStep = 'postgres';
      creds.updatedAt = new Date().toISOString();
      await dbService.saveUserCredentials(creds);
      return res.json({
        success: true,
        message: 'Qdrant setup skipped. Standalone vector memory will be used.',
        setupStatus: formatSetupStatus(userId, creds),
      });
    }

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Valid Qdrant cluster URL (http/https) is required' });
    }

    const trimmedUrl = url.trim();
    const trimmedApiKey = apiKey ? apiKey.trim() : '';

    // Verify connection to Qdrant cluster
    try {
      const client = new QdrantClient({
        url: trimmedUrl,
        apiKey: trimmedApiKey || undefined,
        checkCompatibility: false,
      });
      await client.getCollections();
    } catch (testErr: any) {
      return res.status(400).json({
        error: `Qdrant connection failed: ${testErr.message || 'Cluster unreachable'}. Please check URL and API Key.`,
      });
    }

    const encUrl = CryptoService.encryptSecret(trimmedUrl);
    creds.qdrantUrlEncrypted = encUrl.encrypted;
    creds.qdrantUrlIv = encUrl.iv;
    creds.qdrantUrlTag = encUrl.tag;
    creds.qdrantUrlMasked = CryptoService.maskSecret(trimmedUrl, 'url');

    if (trimmedApiKey) {
      const encKey = CryptoService.encryptSecret(trimmedApiKey);
      creds.qdrantApiKeyEncrypted = encKey.encrypted;
      creds.qdrantApiKeyIv = encKey.iv;
      creds.qdrantApiKeyTag = encKey.tag;
      creds.qdrantApiKeyMasked = CryptoService.maskSecret(trimmedApiKey);
    } else {
      creds.qdrantApiKeyEncrypted = undefined;
      creds.qdrantApiKeyIv = undefined;
      creds.qdrantApiKeyTag = undefined;
      creds.qdrantApiKeyMasked = undefined;
    }

    creds.qdrantVerified = true;
    creds.currentSetupStep = 'postgres';
    creds.updatedAt = new Date().toISOString();

    await dbService.saveUserCredentials(creds);

    res.json({
      success: true,
      message: 'Qdrant vector cluster verified and credentials encrypted.',
      setupStatus: formatSetupStatus(userId, creds),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/setup/postgres
setupRouter.post('/postgres', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { connectionUrl, skip } = req.body;

    let creds = (await dbService.getUserCredentials(userId)) || {
      userId,
      geminiVerified: false,
      qdrantVerified: false,
      postgresVerified: false,
      setupCompleted: false,
      currentSetupStep: 'postgres',
      updatedAt: new Date().toISOString(),
    };

    if (skip) {
      creds.currentSetupStep = 'ready';
      creds.updatedAt = new Date().toISOString();
      await dbService.saveUserCredentials(creds);
      return res.json({
        success: true,
        message: 'PostgreSQL setup skipped. Snapshot storage mode active.',
        setupStatus: formatSetupStatus(userId, creds),
      });
    }

    if (!connectionUrl || typeof connectionUrl !== 'string' || !connectionUrl.includes('postgres')) {
      return res.status(400).json({ error: 'Valid PostgreSQL connection string (postgresql://...) is required' });
    }

    const trimmedUrl = connectionUrl.trim();

    // Verify connection to PostgreSQL database
    let testPool: Pool | null = null;
    try {
      testPool = new Pool({
        connectionString: trimmedUrl,
        connectionTimeoutMillis: 4000,
      });
      const client = await testPool.connect();
      await client.query('SELECT NOW()');
      client.release();
      await testPool.end();
    } catch (testErr: any) {
      if (testPool) {
        try {
          await testPool.end();
        } catch {}
      }
      return res.status(400).json({
        error: `PostgreSQL connection failed: ${testErr.message || 'Database unreachable'}. Please verify credentials and SSL settings.`,
      });
    }

    const encUrl = CryptoService.encryptSecret(trimmedUrl);
    creds.postgresUrlEncrypted = encUrl.encrypted;
    creds.postgresUrlIv = encUrl.iv;
    creds.postgresUrlTag = encUrl.tag;
    creds.postgresUrlMasked = CryptoService.maskSecret(trimmedUrl, 'url');
    creds.postgresVerified = true;
    creds.currentSetupStep = 'ready';
    creds.updatedAt = new Date().toISOString();

    await dbService.saveUserCredentials(creds);

    res.json({
      success: true,
      message: 'PostgreSQL database connection verified and encrypted.',
      setupStatus: formatSetupStatus(userId, creds),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/setup/complete
setupRouter.post('/complete', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    let creds = (await dbService.getUserCredentials(userId)) || {
      userId,
      geminiVerified: false,
      qdrantVerified: false,
      postgresVerified: false,
      setupCompleted: false,
      currentSetupStep: 'ready',
      updatedAt: new Date().toISOString(),
    };

    creds.setupCompleted = true;
    creds.currentSetupStep = 'completed';
    creds.updatedAt = new Date().toISOString();

    await dbService.saveUserCredentials(creds);

    res.json({
      success: true,
      message: 'ONYX workspace setup completed successfully.',
      setupStatus: formatSetupStatus(userId, creds),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/setup/test-connection
setupRouter.post('/test-connection', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { target } = req.body; // 'gemini' | 'qdrant' | 'postgres'
    const creds = await dbService.getUserCredentials(userId);

    const startTime = Date.now();

    if (target === 'gemini') {
      let apiKey = '';
      if (creds?.geminiApiKeyEncrypted && creds.geminiApiKeyIv && creds.geminiApiKeyTag) {
        apiKey = CryptoService.decryptSecret(
          creds.geminiApiKeyEncrypted,
          creds.geminiApiKeyIv,
          creds.geminiApiKeyTag
        );
      } else if (process.env.GEMINI_API_KEY) {
        apiKey = process.env.GEMINI_API_KEY;
      }

      if (!apiKey) {
        return res.json({ connected: false, latencyMs: 0, message: 'No Gemini API key configured.' });
      }

      try {
        const ai = new GoogleGenAI({ apiKey });
        await ai.models.countTokens({ model: 'gemini-2.5-flash', contents: 'ping' });
        const latencyMs = Date.now() - startTime;
        return res.json({ connected: true, latencyMs, message: 'Gemini API connection healthy' });
      } catch (err: any) {
        return res.json({ connected: false, latencyMs: Date.now() - startTime, message: err.message });
      }
    }

    if (target === 'qdrant') {
      let url = '';
      let apiKey: string | undefined = undefined;
      if (creds?.qdrantUrlEncrypted && creds.qdrantUrlIv && creds.qdrantUrlTag) {
        url = CryptoService.decryptSecret(creds.qdrantUrlEncrypted, creds.qdrantUrlIv, creds.qdrantUrlTag);
        if (creds.qdrantApiKeyEncrypted && creds.qdrantApiKeyIv && creds.qdrantApiKeyTag) {
          apiKey = CryptoService.decryptSecret(
            creds.qdrantApiKeyEncrypted,
            creds.qdrantApiKeyIv,
            creds.qdrantApiKeyTag
          );
        }
      }

      if (!url) {
        return res.json({ connected: false, latencyMs: 0, message: 'No custom Qdrant URL configured.' });
      }

      try {
        const client = new QdrantClient({ url, apiKey, checkCompatibility: false });
        await client.getCollections();
        return res.json({ connected: true, latencyMs: Date.now() - startTime, message: 'Qdrant cluster responsive' });
      } catch (err: any) {
        return res.json({ connected: false, latencyMs: Date.now() - startTime, message: err.message });
      }
    }

    if (target === 'postgres') {
      let connectionUrl = '';
      if (creds?.postgresUrlEncrypted && creds.postgresUrlIv && creds.postgresUrlTag) {
        connectionUrl = CryptoService.decryptSecret(
          creds.postgresUrlEncrypted,
          creds.postgresUrlIv,
          creds.postgresUrlTag
        );
      }

      if (!connectionUrl) {
        return res.json({ connected: false, latencyMs: 0, message: 'No custom PostgreSQL URL configured.' });
      }

      let pool: Pool | null = null;
      try {
        pool = new Pool({ connectionString: connectionUrl, connectionTimeoutMillis: 3000 });
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        await pool.end();
        return res.json({ connected: true, latencyMs: Date.now() - startTime, message: 'PostgreSQL database connected' });
      } catch (err: any) {
        if (pool) {
          try {
            await pool.end();
          } catch {}
        }
        return res.json({ connected: false, latencyMs: Date.now() - startTime, message: err.message });
      }
    }

    res.status(400).json({ error: 'Invalid target' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
