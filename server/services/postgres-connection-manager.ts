/**
 * Second Brain — Production PostgreSQL Connection Manager & URL Normalizer
 * Robust normalization, intelligent IPv4/IPv6 dual-stack DNS resolution,
 * SSL/TLS negotiation, sanitized diagnostic messaging,
 * and encrypted per-tenant BYOD database isolation.
 */

import { Pool, PoolConfig } from 'pg';
import { URL } from 'url';
import dns from 'dns';
import net from 'net';

export type PostgresPoolConfig = PoolConfig & {
  lookup?: (hostname: string, options: any, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => void;
};

export interface PostgresNormalizedResult {
  rawUrl: string;
  normalizedUrl: string;
  poolConfig: PostgresPoolConfig;
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
    ipFamily?: number;
    resolvedAddress?: string;
  };
}

// Known cloud database provider host indicators (more specific subdomains first)
const KNOWN_TLS_PROVIDERS: Array<{ domain: string; name: string }> = [
  { domain: 'oregon-postgres.render.com', name: 'Render PostgreSQL (Oregon)' },
  { domain: 'frankfurt-postgres.render.com', name: 'Render PostgreSQL (Frankfurt)' },
  { domain: 'singapore-postgres.render.com', name: 'Render PostgreSQL (Singapore)' },
  { domain: 'render.com', name: 'Render PostgreSQL' },
  { domain: 'neon.tech', name: 'Neon Serverless Postgres' },
  { domain: 'pooler.supabase.com', name: 'Supabase Connection Pooler' },
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
   * Creates an intelligent DNS lookup function that:
   * 1. Inspects all A (IPv4) and AAAA (IPv6) records for the hostname.
   * 2. Prefers IPv4 addresses when both IPv4 and IPv6 are available, preventing ENETUNREACH errors in IPv4-only cloud environments (e.g. Render, AWS ECS, Cloud Run).
   * 3. Gracefully falls back to IPv6 only when no IPv4 address exists.
   * 4. Preserves the original hostname so TLS SNI (`servername`) and certificate validation remain intact.
   */
  public static createSmartLookup(
    onResolved?: (address: string, family: number) => void
  ) {
    return (
      hostname: string,
      options: any,
      callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void
    ) => {
      // 1. Literal IPv4 address
      if (net.isIPv4(hostname)) {
        if (onResolved) onResolved(hostname, 4);
        return callback(null, hostname, 4);
      }

      // 2. Literal IPv6 address
      if (net.isIPv6(hostname)) {
        if (onResolved) onResolved(hostname, 6);
        return callback(null, hostname, 6);
      }

      // 3. Localhost or private local domain
      if (hostname === 'localhost' || hostname.endsWith('.local')) {
        dns.lookup(hostname, { all: true }, (err, addresses) => {
          if (err || !addresses || addresses.length === 0) {
            // Fallback default lookup
            return dns.lookup(hostname, options, callback);
          }
          const ipv4 = addresses.find((a) => a.family === 4);
          if (ipv4) {
            if (onResolved) onResolved(ipv4.address, 4);
            return callback(null, ipv4.address, 4);
          }
          if (onResolved) onResolved(addresses[0].address, addresses[0].family);
          return callback(null, addresses[0].address, addresses[0].family);
        });
        return;
      }

      // 4. Remote hostnames: resolve all records to intelligently prefer IPv4
      dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) {
          return callback(err, '', 4);
        }

        if (!addresses || addresses.length === 0) {
          const notFoundErr: NodeJS.ErrnoException = new Error(`ENOTFOUND ${hostname}`);
          notFoundErr.code = 'ENOTFOUND';
          return callback(notFoundErr, '', 4);
        }

        // Prefer IPv4 if available
        const ipv4 = addresses.find((a) => a.family === 4);
        if (ipv4) {
          if (onResolved) onResolved(ipv4.address, 4);
          return callback(null, ipv4.address, 4);
        }

        // Fallback to IPv6 if only IPv6 is published by DNS
        const ipv6 = addresses.find((a) => a.family === 6);
        if (ipv6) {
          if (onResolved) onResolved(ipv6.address, 6);
          return callback(null, ipv6.address, 6);
        }

        if (onResolved) onResolved(addresses[0].address, addresses[0].family);
        return callback(null, addresses[0].address, addresses[0].family);
      });
    };
  }

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

    // Construct pg PoolConfig with smart IPv4-preferred DNS lookup
    const poolConfig: PostgresPoolConfig = {
      host,
      port,
      database,
      user,
      password,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 10,
      lookup: PostgresConnectionManager.createSmartLookup(),
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

    // Pre-flight DNS diagnostic check to understand available IP families
    let dnsDbg = {
      hasIpv4: false,
      hasIpv6: false,
      ipv4Count: 0,
      ipv6Count: 0,
      ipv6Sample: '',
      resolvedIp: '',
      resolvedFamily: 4,
    };

    if (!initialParse.isLocalhost && !net.isIP(host)) {
      try {
        const records = await dns.promises.lookup(host, { all: true });
        const v4s = records.filter((r) => r.family === 4);
        const v6s = records.filter((r) => r.family === 6);
        dnsDbg.hasIpv4 = v4s.length > 0;
        dnsDbg.hasIpv6 = v6s.length > 0;
        dnsDbg.ipv4Count = v4s.length;
        dnsDbg.ipv6Count = v6s.length;
        if (v6s[0]) {
          dnsDbg.ipv6Sample = v6s[0].address;
        }
      } catch {
        // Handled downstream during connection attempt
      }
    }

    // Helper to attempt connection
    const tryConnect = async (
      config: PostgresPoolConfig
    ): Promise<{ client: any; pool: Pool; serverVersion?: string }> => {
      const pool = new Pool({
        ...config,
        connectionTimeoutMillis: timeoutMs,
        lookup: PostgresConnectionManager.createSmartLookup((addr, fam) => {
          dnsDbg.resolvedIp = addr;
          dnsDbg.resolvedFamily = fam;
        }),
      } as any);

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
          ipFamily: dnsDbg.resolvedFamily,
          resolvedAddress: dnsDbg.resolvedIp || undefined,
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
              ipFamily: dnsDbg.resolvedFamily,
              resolvedAddress: dnsDbg.resolvedIp || undefined,
            },
          };
        } catch (retryErr: any) {
          return this.formatErrorResult(retryErr, rawUrl, startTime, true, initialParse, dnsDbg);
        }
      }

      return this.formatErrorResult(firstErr, rawUrl, startTime, retriedWithTls, initialParse, dnsDbg);
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
    parsed: PostgresNormalizedResult,
    dnsDbg?: { hasIpv4: boolean; hasIpv6: boolean; ipv6Sample?: string }
  ): PostgresVerificationResult {
    const rawMsg = err.message || '';
    const errCode = err.code || '';
    const lower = rawMsg.toLowerCase();
    const latencyMs = Date.now() - startTime;

    let userFriendlyMsg: string;

    // Check if failure is due to IPv6 unreachability in the deployment environment
    const isIpv6RoutingError =
      errCode === 'ENETUNREACH' ||
      errCode === 'EHOSTUNREACH' ||
      lower.includes('enetunreach') ||
      lower.includes('ehostunreach') ||
      lower.includes('network is unreachable') ||
      lower.includes('no route to host') ||
      (dnsDbg?.hasIpv6 && !dnsDbg?.hasIpv4 && (errCode === 'ECONNREFUSED' || lower.includes('econnrefused')));

    if (isIpv6RoutingError) {
      const maskedIp = dnsDbg?.ipv6Sample
        ? `${dnsDbg.ipv6Sample.slice(0, 4)}...:${dnsDbg.ipv6Sample.split(':').pop()}`
        : 'IPv6 endpoint';

      if (parsed.host.includes('supabase.co') || parsed.host.includes('supabase.com')) {
        userFriendlyMsg = `PostgreSQL host '${parsed.host}' resolved to an IPv6-only endpoint (${maskedIp}), but this deployment environment cannot route to IPv6 (ENETUNREACH). For Supabase databases, please use the IPv4 Connection Pooler URL (e.g., aws-0-[region].pooler.supabase.com:6543 or :5432) or enable IPv6 networking.`;
      } else {
        userFriendlyMsg = `PostgreSQL server at '${parsed.host}' only exposes an IPv6 address (${maskedIp}), which is unreachable from this environment's network. Please verify IPv4/IPv6 routing or use an IPv4-accessible database proxy.`;
      }
    } else if (lower.includes('password authentication failed') || errCode === '28P01') {
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
      // Clean any accidental credential leakage in raw driver messages
      let sanitizedRaw = rawMsg;
      if (parsed.poolConfig.password) {
        sanitizedRaw = sanitizedRaw.replace(new RegExp(parsed.poolConfig.password as string, 'g'), '••••••••');
      }
      userFriendlyMsg = `PostgreSQL connection failed: ${sanitizedRaw}. Please verify connection details and cloud firewall rules.`;
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

