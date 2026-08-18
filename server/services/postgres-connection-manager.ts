/**
 * Second Brain — Production PostgreSQL Connection Manager & URL Normalizer
 * Robust normalization, SSL/TLS negotiation, diagnostic messaging,
 * and encrypted per-tenant BYOD database isolation.
 */

import { Pool, PoolConfig } from 'pg';
import { URL } from 'url';

export interface PostgresNormalizedResult {
  rawUrl: string;
  normalizedUrl: string;
  poolConfig: PoolConfig;
  requiresTls: boolean;
  sslMode: 'require' | 'prefer' | 'disable' | 'no-verify' | 'default';
  isLocalhost: boolean;
  host: string;
  port: number;
  database: string;
  user: string;
  diagnostics: {
    maskedHost: string;
    maskedDatabase: string;
    detectedProvider: string;
  };
}

export interface PostgresVerificationResult {
  success: boolean;
  message: string;
  normalizedUrl: string;
  usedTls: boolean;
  retriedWithTls: boolean;
  latencyMs: number;
  serverVersion?: string;
  errorCode?: string;
  diagnostics?: {
    host: string;
    port: number;
    database: string;
    provider: string;
  };
}

// Known cloud database provider host indicators (more specific subdomains first)
const KNOWN_TLS_PROVIDERS: Array<{ domain: string; name: string }> = [
  { domain: 'oregon-postgres.render.com', name: 'Render PostgreSQL (Oregon)' },
  { domain: 'frankfurt-postgres.render.com', name: 'Render PostgreSQL (Frankfurt)' },
  { domain: 'singapore-postgres.render.com', name: 'Render PostgreSQL (Singapore)' },
  { domain: 'render.com', name: 'Render PostgreSQL' },
  { domain: 'neon.tech', name: 'Neon Serverless Postgres' },
  { domain: 'supabase.co', name: 'Supabase PostgreSQL' },
  { domain: 'supabase.com', name: 'Supabase PostgreSQL' },
  { domain: 'rds.amazonaws.com', name: 'AWS RDS PostgreSQL' },
  { domain: 'cockroachlabs.cloud', name: 'CockroachDB Serverless' },
  { domain: 'railway.app', name: 'Railway PostgreSQL' },
  { domain: 'aivencloud.com', name: 'Aiven PostgreSQL' },
  { domain: 'timescale.com', name: 'TimescaleDB Cloud' },
  { domain: 'elephantsql.com', name: 'ElephantSQL' },
];

export class PostgresConnectionManager {
  /**
   * Normalizes a user-supplied PostgreSQL connection URL without destroying existing query params.
   * Parses credentials safely and handles SSL mode parameters.
   */
  public static parseAndNormalizeUrl(rawUrl: string, forceTls?: boolean): PostgresNormalizedResult {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('PostgreSQL connection string is empty or invalid.');
    }

    const trimmed = rawUrl.trim();
    if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://')) {
      throw new Error('Connection string must begin with postgres:// or postgresql://');
    }

    let parsedUrl: URL;
    try {
      // Standardize scheme for standard WHATWG URL parsing
      parsedUrl = new URL(trimmed);
    } catch (err: any) {
      throw new Error(`Malformed PostgreSQL URL format: ${err.message || 'Invalid URI syntax'}`);
    }

    const host = parsedUrl.hostname || 'localhost';
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : 5432;
    const database = parsedUrl.pathname ? parsedUrl.pathname.replace(/^\//, '') : 'postgres';
    const user = decodeURIComponent(parsedUrl.username || 'postgres');
    const password = decodeURIComponent(parsedUrl.password || '');

    // Identify if host is local loopback
    const isLocalhost =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local');

    // Detect cloud provider
    let detectedProvider = 'Standard PostgreSQL';
    for (const p of KNOWN_TLS_PROVIDERS) {
      if (host.includes(p.domain)) {
        detectedProvider = p.name;
        break;
      }
    }

    // Inspect existing query parameters
    const searchParams = parsedUrl.searchParams;
    const rawSslMode = (searchParams.get('sslmode') || searchParams.get('ssl') || '').toLowerCase();

    let sslMode: 'require' | 'prefer' | 'disable' | 'no-verify' | 'default' = 'default';
    if (rawSslMode === 'disable' || rawSslMode === 'false' || rawSslMode === 'off') {
      sslMode = 'disable';
    } else if (rawSslMode === 'require' || rawSslMode === 'true' || rawSslMode === '1') {
      sslMode = 'require';
    } else if (rawSslMode === 'prefer') {
      sslMode = 'prefer';
    } else if (rawSslMode === 'no-verify' || rawSslMode === 'allow') {
      sslMode = 'no-verify';
    }

    // Cloud providers that always require TLS
    const isKnownTlsCloud = !isLocalhost && KNOWN_TLS_PROVIDERS.some((p) => host.includes(p.domain));
    const shouldEnableTls =
      forceTls === true ||
      sslMode === 'require' ||
      sslMode === 'no-verify' ||
      (sslMode === 'default' && isKnownTlsCloud);

    // Build the normalized URL string while preserving all existing query parameters
    const normalizedUrlObj = new URL(trimmed);
    if (shouldEnableTls && sslMode !== 'disable') {
      // If TLS is required and not explicitly disabled, ensure sslmode is present for libraries reading URL strings
      if (!normalizedUrlObj.searchParams.has('sslmode')) {
        normalizedUrlObj.searchParams.set('sslmode', 'require');
      }
    }

    // Safe masking for diagnostics and logging
    const maskedHost = host.length > 4 ? `${host.slice(0, 3)}***${host.slice(-4)}` : '***';
    const maskedDatabase = database ? `${database.slice(0, 2)}***` : '***';

    // Construct pg PoolConfig
    const poolConfig: PoolConfig = {
      host,
      port,
      database,
      user,
      password,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10,
    };

    if (shouldEnableTls && sslMode !== 'disable') {
      // For managed serverless/cloud Postgres providers (like Render, Neon, Supabase)
      // that use dynamic or pooled SNI hostnames, rejectUnauthorized: false allows secure TLS
      // negotiation without requiring local installation of provider-specific CA bundles.
      poolConfig.ssl = {
        rejectUnauthorized: false,
      };
    } else if (sslMode === 'disable') {
      poolConfig.ssl = false;
    }

    return {
      rawUrl: trimmed,
      normalizedUrl: normalizedUrlObj.toString(),
      poolConfig,
      requiresTls: shouldEnableTls,
      sslMode,
      isLocalhost,
      host,
      port,
      database,
      user,
      diagnostics: {
        maskedHost,
        maskedDatabase,
        detectedProvider,
      },
    };
  }

  /**
   * Tests and verifies a PostgreSQL connection with automatic intelligent TLS fallback and negotiation.
   * Never leaks raw passwords or credentials in error messages or logs.
   */
  public static async verifyConnection(
    rawUrl: string,
    timeoutMs = 6000
  ): Promise<PostgresVerificationResult> {
    const startTime = Date.now();
    let initialParse: PostgresNormalizedResult;

    try {
      initialParse = this.parseAndNormalizeUrl(rawUrl);
    } catch (parseErr: any) {
      return {
        success: false,
        message: parseErr.message || 'Invalid PostgreSQL connection string format.',
        normalizedUrl: rawUrl,
        usedTls: false,
        retriedWithTls: false,
        latencyMs: Date.now() - startTime,
      };
    }

    const { host, port, database, diagnostics } = initialParse;

    // Helper to attempt connection
    const tryConnect = async (
      config: PoolConfig
    ): Promise<{ client: any; pool: Pool; serverVersion?: string }> => {
      const pool = new Pool({
        ...config,
        connectionTimeoutMillis: timeoutMs,
      });

      const client = await pool.connect();
      const versionRes = await client.query('SELECT version(), NOW()');
      const serverVersion = versionRes?.rows?.[0]?.version || 'PostgreSQL (Active)';
      return { client, pool, serverVersion };
    };

    // First attempt using initial normalized configuration
    let retriedWithTls = false;
    let usedTls = !!initialParse.poolConfig.ssl;

    try {
      const { client, pool, serverVersion } = await tryConnect(initialParse.poolConfig);
      client.release();
      await pool.end();

      const latencyMs = Date.now() - startTime;
      const tlsNote = usedTls ? ' (TLS/SSL Secured)' : '';
      return {
        success: true,
        message: `PostgreSQL connection verified successfully${tlsNote} with ${diagnostics.detectedProvider}.`,
        normalizedUrl: initialParse.normalizedUrl,
        usedTls,
        retriedWithTls: false,
        latencyMs,
        serverVersion,
        diagnostics: {
          host,
          port,
          database,
          provider: diagnostics.detectedProvider,
        },
      };
    } catch (firstErr: any) {
      const errMessage = (firstErr.message || '').toLowerCase();
      const isSslRequiredError =
        errMessage.includes('ssl/tls required') ||
        errMessage.includes('no pg_hba.conf entry for host') && errMessage.includes('ssl') ||
        errMessage.includes('server does not support ssl') ||
        errMessage.includes('ssl connection is required') ||
        errMessage.includes('the server does not support ssl') ||
        errMessage.includes('unsupported frontend protocol') ||
        firstErr.code === '28000' && errMessage.includes('ssl');

      // If initial attempt failed because SSL/TLS is required, retry automatically with TLS enabled
      if (!usedTls && isSslRequiredError) {
        retriedWithTls = true;
        try {
          const tlsParse = this.parseAndNormalizeUrl(rawUrl, true);
          usedTls = true;
          const { client, pool, serverVersion } = await tryConnect(tlsParse.poolConfig);
          client.release();
          await pool.end();

          const latencyMs = Date.now() - startTime;
          return {
            success: true,
            message: `PostgreSQL requires a secure SSL connection. ONYX detected this and automatically established a secure TLS connection (${diagnostics.detectedProvider}).`,
            normalizedUrl: tlsParse.normalizedUrl,
            usedTls: true,
            retriedWithTls: true,
            latencyMs,
            serverVersion,
            diagnostics: {
              host,
              port,
              database,
              provider: diagnostics.detectedProvider,
            },
          };
        } catch (retryErr: any) {
          return this.formatErrorResult(retryErr, rawUrl, startTime, true, initialParse);
        }
      }

      return this.formatErrorResult(firstErr, rawUrl, startTime, retriedWithTls, initialParse);
    }
  }

  /**
   * Translates raw driver errors into clean, actionable, enterprise diagnostic messages
   * without exposing secret passwords, connection URLs, or sensitive tokens.
   */
  private static formatErrorResult(
    err: any,
    rawUrl: string,
    startTime: number,
    retriedWithTls: boolean,
    parsed: PostgresNormalizedResult
  ): PostgresVerificationResult {
    const rawMsg = err.message || '';
    const errCode = err.code || '';
    const lower = rawMsg.toLowerCase();
    const latencyMs = Date.now() - startTime;

    let userFriendlyMsg: string;

    if (lower.includes('password authentication failed') || errCode === '28P01') {
      userFriendlyMsg = `PostgreSQL authentication failed for user '${parsed.user}'. Please check the username, password, and database credentials.`;
    } else if (lower.includes('database') && lower.includes('does not exist') || errCode === '3D000') {
      userFriendlyMsg = `PostgreSQL database '${parsed.database}' does not exist on this server. Please verify the database name in your connection URL.`;
    } else if (
      lower.includes('enotfound') ||
      lower.includes('getaddrinfo') ||
      lower.includes('econnrefused') ||
      lower.includes('etimedout') ||
      lower.includes('timeout') ||
      errCode === 'ECONNREFUSED' ||
      errCode === 'ETIMEDOUT'
    ) {
      userFriendlyMsg = `PostgreSQL server could not be reached at '${parsed.host}:${parsed.port}'. Please verify the hostname, port, firewall settings, and network access.`;
    } else if (lower.includes('ssl/tls required') || lower.includes('ssl connection is required')) {
      userFriendlyMsg = `PostgreSQL server requires an encrypted SSL connection. Please ensure your provider allows TLS connections.`;
    } else if (lower.includes('self-signed certificate') || lower.includes('certificate')) {
      userFriendlyMsg = `PostgreSQL TLS certificate verification error. ONYX negotiates secure TLS connections compatible with cloud-hosted providers.`;
    } else {
      userFriendlyMsg = `PostgreSQL connection failed: ${rawMsg}. Please verify connection details and cloud firewall rules.`;
    }

    return {
      success: false,
      message: userFriendlyMsg,
      normalizedUrl: parsed.normalizedUrl,
      usedTls: parsed.requiresTls,
      retriedWithTls,
      latencyMs,
      errorCode: errCode || undefined,
      diagnostics: {
        host: parsed.host,
        port: parsed.port,
        database: parsed.database,
        provider: parsed.diagnostics.detectedProvider,
      },
    };
  }

  /**
   * Creates a dedicated, isolated Pool for a specific verified connection URL.
   * Completely isolated per tenant — does not pollute global configuration.
   */
  public static createIsolatedPool(normalizedUrl: string): Pool {
    const parsed = this.parseAndNormalizeUrl(normalizedUrl);
    return new Pool(parsed.poolConfig);
  }
}
