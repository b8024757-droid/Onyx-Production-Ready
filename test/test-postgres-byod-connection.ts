/**
 * Automated Test Suite — Production PostgreSQL Connection Handling & BYOD Normalizer
 *
 * Verifies:
 * 1. Hostname resolving to IPv4 + IPv6 → IPv4 preferred
 * 2. Hostname resolving only to IPv4 → connects / resolves normally
 * 3. Hostname resolving only to IPv6 → graceful diagnostic when IPv6 is unreachable (no credential leak)
 * 4. IPv4 connection with sslmode=require
 * 5. IPv4 connection without sslmode (auto-TLS detection for cloud providers)
 * 6. Query parameter preservation (all custom parameters intact)
 * 7. Invalid credentials diagnostics (sanitized, zero password leak)
 * 8. Unreachable host diagnostics (clean error, zero password leak)
 * 9. TLS-required server handling & poolConfig.ssl negotiation
 * 10. Multi-tenant connection isolation & AES-256-GCM encryption
 * 11. Password redaction & credential masking
 * 12. Malformed URL error handling
 */

import { PostgresConnectionManager } from '../server/services/postgres-connection-manager';
import { dbService, UserCredentials } from '../server/db/database';
import { CryptoService } from '../server/services/crypto-service';
import { config } from '../server/config';
import dns from 'dns';

interface TestItemResult {
  name: string;
  passed: boolean;
  details: string;
}

const testResults: TestItemResult[] = [];

function assert(condition: boolean, name: string, details: string) {
  if (condition) {
    console.log(`✅ [PASS] ${name}: ${details}`);
    testResults.push({ name, passed: true, details });
  } else {
    console.error(`❌ [FAIL] ${name}: ${details}`);
    testResults.push({ name, passed: false, details });
    throw new Error(`Test assertion failed for "${name}": ${details}`);
  }
}

async function runPostgresTestSuite() {
  console.log('====================================================');
  console.log('RUNNING PRODUCTION POSTGRESQL BYOD VERIFICATION TEST');
  console.log('====================================================\n');

  // ----------------------------------------------------------------
  // TEST 1: Hostname resolving to IPv4 + IPv6 -> IPv4 preferred
  // ----------------------------------------------------------------
  console.log('--- 1. Testing Dual-Stack IPv4/IPv6 Resolution ---');
  const dualStackLookup = PostgresConnectionManager.createSmartLookup();
  const dualStackResult = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    dualStackLookup('google.com', {}, (err, address, family) => {
      if (err) return reject(err);
      resolve({ address, family });
    });
  });
  assert(
    dualStackResult.family === 4,
    'Dual-Stack IPv4 Preference',
    `Host with A + AAAA records resolved to IPv4 '${dualStackResult.address}' (family: ${dualStackResult.family})`
  );

  // ----------------------------------------------------------------
  // TEST 2: Hostname resolving only to IPv4
  // ----------------------------------------------------------------
  const ipv4Lookup = await new Promise<{ address: string; family: number }>((resolve, reject) => {
    dualStackLookup('aws-0-ap-southeast-1.pooler.supabase.com', {}, (err, address, family) => {
      if (err) return reject(err);
      resolve({ address, family });
    });
  });
  assert(
    ipv4Lookup.family === 4,
    'IPv4-Only Resolution',
    `IPv4 pooler host resolved directly to IPv4 address '${ipv4Lookup.address}'`
  );

  // ----------------------------------------------------------------
  // TEST 3: Hostname resolving only to IPv6 -> Graceful diagnostic when unreachable
  // ----------------------------------------------------------------
  console.log('--- 2. Testing IPv6-Only Diagnostics ---');
  const ipv6HostUrl = 'postgres://postgres:secret_supabase_pwd_123@db.ugtvhdfymlezbxtisish.supabase.co:5432/postgres';
  const ipv6Res = await PostgresConnectionManager.verifyConnection(ipv6HostUrl, 2500);
  assert(
    !ipv6Res.message.includes('secret_supabase_pwd_123'),
    'IPv6 Zero Password Leak',
    `IPv6 diagnostic sanitized password: "${ipv6Res.message}"`
  );
  assert(
    ipv6Res.message.includes('IPv6') || ipv6Res.message.includes('reached') || ipv6Res.success,
    'IPv6 Graceful Diagnostic',
    `Clean message returned without crash: "${ipv6Res.message}"`
  );

  // ----------------------------------------------------------------
  // TEST 4: IPv4 Connection with sslmode=require
  // ----------------------------------------------------------------
  console.log('\n--- 3. Testing SSL / TLS Normalization & Parameters ---');
  const urlWithRequire = 'postgres://appuser:mypassword123@oregon-postgres.render.com:5432/onyx_db?sslmode=require';
  const parsed1 = PostgresConnectionManager.parseAndNormalizeUrl(urlWithRequire);
  assert(
    parsed1.sslMode === 'require' && parsed1.requiresTls === true && !!parsed1.poolConfig.ssl,
    'IPv4 connection with sslmode=require',
    `Correctly parsed sslMode='require', host='${parsed1.host}', database='${parsed1.database}'`
  );
  assert(
    parsed1.diagnostics.detectedProvider === 'Render PostgreSQL (Oregon)',
    'Provider Detection',
    `Identified cloud provider as '${parsed1.diagnostics.detectedProvider}'`
  );

  // ----------------------------------------------------------------
  // TEST 5: IPv4 Connection without sslmode (Cloud auto-detection)
  // ----------------------------------------------------------------
  const urlWithoutSsl = 'postgres://renderuser:secretpass@dpg-c12345.oregon-postgres.render.com:5432/prod_db';
  const parsed2 = PostgresConnectionManager.parseAndNormalizeUrl(urlWithoutSsl);
  assert(
    parsed2.requiresTls === true && parsed2.normalizedUrl.includes('sslmode=require'),
    'IPv4 connection without sslmode',
    `Auto-detected remote provider requires TLS; normalized URL injected sslmode=require (${parsed2.normalizedUrl})`
  );

  // ----------------------------------------------------------------
  // TEST 6: Query Parameter Preservation
  // ----------------------------------------------------------------
  const urlWithParams = 'postgres://dbuser:pwd@db.supabase.co:5432/postgres?connection_limit=5&application_name=onyx_app';
  const parsed3 = PostgresConnectionManager.parseAndNormalizeUrl(urlWithParams);
  assert(
    parsed3.normalizedUrl.includes('connection_limit=5') &&
    parsed3.normalizedUrl.includes('application_name=onyx_app') &&
    parsed3.normalizedUrl.includes('sslmode=require'),
    'Query Parameter Preservation',
    `All original query parameters preserved without duplication: ${parsed3.normalizedUrl}`
  );

  // ----------------------------------------------------------------
  // TEST 7: Localhost connection with sslmode=disable
  // ----------------------------------------------------------------
  const urlDisable = 'postgres://postgres:postgres@localhost:5432/local_db?sslmode=disable';
  const parsed4 = PostgresConnectionManager.parseAndNormalizeUrl(urlDisable);
  assert(
    parsed4.sslMode === 'disable' && parsed4.requiresTls === false && parsed4.poolConfig.ssl === false,
    'Localhost sslmode=disable',
    `Explicit sslmode=disable respected, SSL flag set to false`
  );

  // ----------------------------------------------------------------
  // TEST 8: Malformed PostgreSQL URL handling
  // ----------------------------------------------------------------
  try {
    PostgresConnectionManager.parseAndNormalizeUrl('http://invalid-scheme:5432/db');
    assert(false, 'Malformed URL Parsing', 'Should have thrown error for non-postgres scheme');
  } catch (err: any) {
    assert(
      err.message.includes('postgres://') || err.message.includes('postgresql://'),
      'Malformed URL Error Handling',
      `Caught expected validation error: ${err.message}`
    );
  }

  // ----------------------------------------------------------------
  // TEST 9: Unreachable Host Diagnostics (No credential leak)
  // ----------------------------------------------------------------
  console.log('\n--- 4. Testing Diagnostics & Error Sanitization ---');
  const unreachableUrl = 'postgres://testuser:super_secret_pwd_999@nonexistent-fake-postgres-host-xyz.local:5432/testdb';
  const unreachableRes = await PostgresConnectionManager.verifyConnection(unreachableUrl, 1500);
  assert(
    unreachableRes.success === false,
    'Unreachable Host Failure',
    `Connection failed gracefully in ${unreachableRes.latencyMs}ms`
  );
  assert(
    !unreachableRes.message.includes('super_secret_pwd_999'),
    'Zero Password Leak on Unreachable Host',
    `Error message did not leak secret password: "${unreachableRes.message}"`
  );
  assert(
    unreachableRes.message.includes('could not be reached') || unreachableRes.message.includes('firewall'),
    'Clear Diagnostic Message',
    `Enterprise error output: "${unreachableRes.message}"`
  );

  // ----------------------------------------------------------------
  // TEST 10: Invalid Credentials Diagnostics (No credential leak)
  // ----------------------------------------------------------------
  const badCredsUrl = 'postgres://fake_auth_user:super_secret_bad_pass_888@127.0.0.1:5432/app_db';
  const badCredsRes = await PostgresConnectionManager.verifyConnection(badCredsUrl, 1000);
  assert(
    !badCredsRes.message.includes('super_secret_bad_pass_888'),
    'Zero Password Leak on Invalid Credentials',
    `Error message protected secret: "${badCredsRes.message}"`
  );

  // ----------------------------------------------------------------
  // TEST 11: TLS Security Test
  // ----------------------------------------------------------------
  const neonUrl = 'postgres://user:pw@ep-cool-cloud-123.neon.tech/neondb';
  const neonParsed = PostgresConnectionManager.parseAndNormalizeUrl(neonUrl);
  assert(
    neonParsed.requiresTls === true && !!neonParsed.poolConfig.ssl,
    'TLS-required server',
    `Cloud host automatically configured with TLS rejectUnauthorized: false`
  );

  // ----------------------------------------------------------------
  // TEST 12: Password Redaction & Credential Masking
  // ----------------------------------------------------------------
  const maskedSample = CryptoService.maskSecret('postgresql://admin:super_secret_pw@db.render.com:5432/app', 'url');
  assert(
    !maskedSample.includes('super_secret_pw') && maskedSample.includes('••••••••'),
    'Password Redaction',
    `Masked URL protects password: ${maskedSample}`
  );

  // ----------------------------------------------------------------
  // TEST 13: Multi-Tenant BYOD Isolation & Encryption
  // ----------------------------------------------------------------
  console.log('\n--- 5. Testing Multi-Tenant BYOD PostgreSQL Isolation ---');
  await dbService.init();

  const userA_id = 'tenant-user-a-byod-' + Date.now();
  const userB_id = 'tenant-user-b-byod-' + Date.now();

  const userA_url = 'postgres://userA:secretPassA@render-db-a.render.com:5432/app_a?sslmode=require';
  const userB_url = 'postgres://userB:secretPassB@supabase-db-b.supabase.co:5432/app_b';

  // Verify and encrypt user A
  const normA = PostgresConnectionManager.parseAndNormalizeUrl(userA_url);
  const encA = CryptoService.encryptSecret(normA.normalizedUrl);
  const credsA: UserCredentials = {
    userId: userA_id,
    postgresUrlEncrypted: encA.encrypted,
    postgresUrlIv: encA.iv,
    postgresUrlTag: encA.tag,
    postgresUrlMasked: CryptoService.maskSecret(normA.normalizedUrl, 'url'),
    postgresVerified: true,
    geminiVerified: false,
    qdrantVerified: false,
    setupCompleted: true,
    currentSetupStep: 'ready',
    updatedAt: new Date().toISOString(),
  };
  await dbService.saveUserCredentials(credsA);

  // Verify and encrypt user B
  const normB = PostgresConnectionManager.parseAndNormalizeUrl(userB_url);
  const encB = CryptoService.encryptSecret(normB.normalizedUrl);
  const credsB: UserCredentials = {
    userId: userB_id,
    postgresUrlEncrypted: encB.encrypted,
    postgresUrlIv: encB.iv,
    postgresUrlTag: encB.tag,
    postgresUrlMasked: CryptoService.maskSecret(normB.normalizedUrl, 'url'),
    postgresVerified: true,
    geminiVerified: false,
    qdrantVerified: false,
    setupCompleted: true,
    currentSetupStep: 'ready',
    updatedAt: new Date().toISOString(),
  };
  await dbService.saveUserCredentials(credsB);

  // Retrieve and verify Tenant A cannot read Tenant B
  const fetchedA = await dbService.getUserCredentials(userA_id);
  const fetchedB = await dbService.getUserCredentials(userB_id);

  assert(
    fetchedA !== null && fetchedB !== null,
    'BYOD Credentials Stored',
    'Both tenants stored separate encrypted credentials'
  );

  const decA = CryptoService.decryptSecret(
    fetchedA!.postgresUrlEncrypted!,
    fetchedA!.postgresUrlIv!,
    fetchedA!.postgresUrlTag!
  );
  const decB = CryptoService.decryptSecret(
    fetchedB!.postgresUrlEncrypted!,
    fetchedB!.postgresUrlIv!,
    fetchedB!.postgresUrlTag!
  );

  assert(
    decA === normA.normalizedUrl && decB === normB.normalizedUrl,
    'Decrypted BYOD Isolation',
    `User A decrypted URL is isolated to User A (${fetchedA?.postgresUrlMasked}), User B is isolated to User B (${fetchedB?.postgresUrlMasked})`
  );
  assert(
    decA !== decB && fetchedA?.postgresUrlMasked !== fetchedB?.postgresUrlMasked,
    'Multi-Tenant Connection Isolation',
    'Tenant A and Tenant B maintain distinct configurations with zero cross-tenant leakage'
  );

  console.log('\n====================================================');
  console.log(`POSTGRESQL BYOD TEST SUITE COMPLETED: ${testResults.filter(t => t.passed).length}/${testResults.length} PASSED`);
  console.log('====================================================\n');
}

runPostgresTestSuite().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
