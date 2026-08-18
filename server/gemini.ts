/**
 * Second Brain — Server-side Gemini Client
 * Uses the modern @google/genai TypeScript SDK with User-Agent telemetry
 * and supports per-user decrypted API keys.
 */

import { GoogleGenAI } from '@google/genai';
import { config } from './config';
import { dbService } from './db/database';
import { CryptoService } from './services/crypto-service';

let defaultGeminiClient: GoogleGenAI | null = null;
const userClientCache = new Map<string, { client: GoogleGenAI; keyHash: string }>();

export function getGeminiClient(userId?: string): GoogleGenAI | null {
  if (userId) {
    const creds = dbService.credentials.get(userId);
    if (creds?.geminiApiKeyEncrypted && creds.geminiApiKeyIv && creds.geminiApiKeyTag) {
      const decryptedKey = CryptoService.decryptSecret(
        creds.geminiApiKeyEncrypted,
        creds.geminiApiKeyIv,
        creds.geminiApiKeyTag
      );
      if (decryptedKey) {
        const cached = userClientCache.get(userId);
        if (cached && cached.keyHash === creds.geminiApiKeyEncrypted) {
          return cached.client;
        }
        const client = new GoogleGenAI({
          apiKey: decryptedKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });
        userClientCache.set(userId, { client, keyHash: creds.geminiApiKeyEncrypted });
        return client;
      }
    }
  }

  // Fallback to system environment key
  if (!defaultGeminiClient) {
    const apiKey = config.gemini.apiKey;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return null;
    }
    defaultGeminiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return defaultGeminiClient;
}

export function isGeminiConfigured(userId?: string): boolean {
  if (userId) {
    const creds = dbService.credentials.get(userId);
    if (creds?.geminiVerified && creds.geminiApiKeyEncrypted) return true;
  }
  return !!config.gemini.apiKey && config.gemini.apiKey !== 'MY_GEMINI_API_KEY';
}
