/**
 * Second Brain — Cryptography & Security Service
 * AES-256-GCM encryption for per-user infrastructure credentials,
 * PBKDF2 / scrypt password hashing with high-entropy salts,
 * and signed JWT-compatible authentication tokens.
 */

import crypto from 'crypto';

const MASTER_ENCRYPTION_SECRET =
  process.env.ENCRYPTION_SECRET ||
  process.env.JWT_SECRET ||
  'second-brain-obsidian-infrastructure-aes-256-gcm-master-key-2026';

// Derive fixed 32-byte key for AES-256-GCM
const ENCRYPTION_KEY = crypto.createHash('sha256').update(MASTER_ENCRYPTION_SECRET).digest();

// Token secret for HMAC-SHA256 signing
const TOKEN_SECRET = crypto.createHash('sha256').update(MASTER_ENCRYPTION_SECRET + '-token-v1').digest('hex');

export class CryptoService {
  /**
   * Hashes a password using scrypt with a unique 32-byte salt
   */
  public static hashPassword(password: string): { hash: string; salt: string } {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return { hash, salt };
  }

  /**
   * Verifies password against stored scrypt hash and salt with constant-time comparison
   */
  public static verifyPassword(password: string, storedHash: string, salt: string): boolean {
    try {
      const derived = crypto.scryptSync(password, salt, 64);
      const storedBuffer = Buffer.from(storedHash, 'hex');
      if (derived.length !== storedBuffer.length) return false;
      return crypto.timingSafeEqual(derived, storedBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Encrypts sensitive secrets (API keys, connection strings) using AES-256-GCM
   */
  public static encryptSecret(plainText: string): { encrypted: string; iv: string; tag: string } {
    if (!plainText) {
      return { encrypted: '', iv: '', tag: '' };
    }
    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
      encrypted,
      iv: iv.toString('hex'),
      tag,
    };
  }

  /**
   * Decrypts AES-256-GCM encrypted secrets
   */
  public static decryptSecret(encrypted: string, iv: string, tag: string): string {
    if (!encrypted || !iv || !tag) return '';
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(tag, 'hex'));
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err: any) {
      console.error('[CryptoService] Decryption failed:', err.message);
      return '';
    }
  }

  /**
   * Masks sensitive credentials for safe UI preview display
   */
  public static maskSecret(secret: string, type: 'api_key' | 'url' = 'api_key'): string {
    if (!secret || secret.trim().length === 0) return '';
    const trimmed = secret.trim();

    if (type === 'url') {
      try {
        const url = new URL(trimmed);
        if (url.password) {
          url.password = '••••••••';
          return url.toString();
        }
        return trimmed;
      } catch {
        // Regex mask for postgresql://user:password@host/db
        return trimmed.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••••••@');
      }
    }

    // Default API key masking (e.g. AIzaSy...4xQ)
    if (trimmed.length <= 8) {
      return '••••••••';
    }
    const prefix = trimmed.slice(0, 6);
    const suffix = trimmed.slice(-4);
    return `${prefix}••••••••${suffix}`;
  }

  /**
   * Creates a signed JWT-compatible authentication token (Header.Payload.Signature)
   */
  public static createAuthToken(payload: Record<string, any>, expiresInSec = 86400 * 30): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = {
      ...payload,
      iat: now,
      exp: now + expiresInSec,
    };

    const headerBase64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadBase64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(`${headerBase64}.${payloadBase64}`)
      .digest('base64url');

    return `${headerBase64}.${payloadBase64}.${signature}`;
  }

  /**
   * Verifies and decodes a signed authentication token
   */
  public static verifyAuthToken<T = any>(token: string): T | null {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerBase64, payloadBase64, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', TOKEN_SECRET)
      .update(`${headerBase64}.${payloadBase64}`)
      .digest('base64url');

    if (signature !== expectedSig) {
      return null;
    }

    try {
      const payloadStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
      const payload = JSON.parse(payloadStr);
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && payload.exp < now) {
        return null; // Expired
      }
      return payload as T;
    } catch {
      return null;
    }
  }

  /**
   * Generates a cryptographically random token for password resets
   */
  public static generateRandomToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
  }
}
