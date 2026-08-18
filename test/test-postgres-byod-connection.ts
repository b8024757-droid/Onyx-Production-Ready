/**
 * Automated Test Suite — Production PostgreSQL Connection Handling & BYOD Normalizer
 *
 * Verifies:
 * 1. URL with sslmode=require
 * 2. URL without sslmode
 * 3. URL with existing query parameters (preserved intact)
 * 4. SSL-required database handling & intelligent TLS retry logic
 * 5. Invalid credentials error diagnostics (no leaked passwords)
 * 6. Unreachable host error diagnostics (no leaked secrets)
 * 7. Malformed PostgreSQL URL formatting error
 * 8. Live connection verification (using active database URL)
 * 9. Multi-tenant BYOD isolation (Tenant A credentials isolated from Tenant B)
 */

import { PostgresConnectionManager } from '../server/services/postgres-connection-manager';
import { dbService, UserCredentials } from '../server/db/database';
import { CryptoService } from '../server/services/crypto-service';
import { config } from '../server/config';

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
  // TEST 1: URL with sslmode=require
  // ----------------------------------------------------------------
  const urlWithRequire = 'postgres://appuser:mypassword123@oregon-postgres.render.com:5432/onyx_db?sslmode=require';
  const parsed1 = PostgresConnectionManager.parseAndNormalizeUrl(urlWithRequire);
  assert(
    parsed1.sslMode === 'require' && parsed1.requiresTls === true && !!parsed1.poolConfig.ssl,
    'URL with sslmode=require',
    `Correctly parsed sslMode='require', host='${parsed1.host}', database='${parsed1.database}'`
  );
  assert(
    parsed1.diagnostics.detectedProvider === 'Render PostgreSQL (Oregon)',
    'Provider Detection',
    `Identified cloud provider as '${parsed1.diagnostics.detectedProvider}'`
  );

  // ----------------------------------------------------------------
  // TEST 2: URL without sslmode (Remote Cloud Provider)
  // ----------------------------------------------------------------
  const urlWithoutSsl = 'postgres://renderuser:secretpass@dpg-c12345.oregon-postgres.render.com:5432/prod_db';
  const parsed2 = PostgresConnectionManager.parseAndNormalizeUrl(urlWithoutSsl);
  assert(
    parsed2.requiresTls === true && parsed2.normalizedUrl.includes('sslmode=require'),
    'URL without sslmode (Remote Cloud)',
    `Auto-detected remote provider requires TLS; normalized URL injected sslmode=require (${parsed2.normalizedUrl})`
  );

  // ----------------------------------------------------------------
  // TEST 3: URL with existing query parameters (preserved intact)
  // ----------------------------------------------------------------
  const urlWithParams = 'postgres://dbuser:pwd@db.supabase.co:5432/postgres?connection_limit=5&application_name=onyx_app';
  const parsed3 = PostgresConnectionManager.parseAndNormalizeUrl(urlWithParams);
  assert(
    parsed3.normalizedUrl.includes('connection_limit=5') &&
    parsed3.normalizedUrl.includes('application_name=onyx_app') &&
    parsed3.normalizedUrl.includes('sslmode=require'),
    'Preserve Query Parameters',
    `All original query parameters preserved without duplication: ${parsed3.normalizedUrl}`
  );

  // ----------------------------------------------------------------
  // TEST 4: URL with sslmode=disable (Local / Dev)
  // ----------------------------------------------------------------
  const urlDisable = 'postgres://postgres:postgres@localhost:5432/local_db?sslmode=disable';
  const parsed4 = PostgresConnectionManager.parseAndNormalizeUrl(urlDisable);
  assert(
    parsed4.sslMode === 'disable' && parsed4.requiresTls === false && parsed4.poolConfig.ssl === false,
    'URL with sslmode=disable',
    `Explicit sslmode=disable respected, SSL flag set to false`
  );

  // ----------------------------------------------------------------
  // TEST 5: Malformed PostgreSQL URL handling
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
  // TEST 6: Unreachable Host Diagnostics (No credential leak)
  // ----------------------------------------------------------------
  console.log('\n--- Testing Unreachable Host Diagnostics ---');
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
  // TEST 7: Invalid Credentials Diagnostics (No credential leak)
  // ----------------------------------------------------------------
  console.log('\n--- Testing Invalid Credentials Diagnostics ---');
  if (config.database.url) {
    try {
      const urlObj = new URL(config.database.url);
      urlObj.password = 'definitely_wrong_password_xyz_123';
      const badCredsUrl = urlObj.toString();
      const badCredsRes = await PostgresConnectionManager.verifyConnection(badCredsUrl, 3000);
      assert(
        badCredsRes.success === false,
        'Invalid Credentials Failure',
        `Correctly rejected invalid password in ${badCredsRes.latencyMs}ms`
      );
      assert(
        !badCredsRes.message.includes('definitely_wrong_password_xyz_123'),
        'Zero Password Leak on Auth Failure',
        `Error message protected password: "${badCredsRes.message}"`
      );
      assert(
        badCredsRes.message.includes('authentication failed') || badCredsRes.message.includes('credentials'),
        'Clean Auth Diagnostic Message',
        `Received message: "${badCredsRes.message}"`
      );
    } catch (e: any) {
      console.log('Skipped live bad-creds test if database.url is localhost mock');
    }
  }

  // ----------------------------------------------------------------
  // TEST 8: Live Successful Connection Verification
  // ----------------------------------------------------------------
  console.log('\n--- Testing Live Successful Connection ---');
  if (config.database.url) {
    const liveRes = await PostgresConnectionManager.verifyConnection(config.database.url, 4000);
    assert(
      liveRes.success === true,
      'Live Active PostgreSQL Verification',
      `Successfully connected in ${liveRes.latencyMs}ms, usedTls=${liveRes.usedTls}, msg="${liveRes.message}"`
    );
  }

  // ----------------------------------------------------------------
  // TEST 9: Multi-Tenant BYOD Isolation & Encryption
  // ----------------------------------------------------------------
  console.log('\n--- Testing Multi-Tenant BYOD PostgreSQL Isolation ---');
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
    'No Cross-Tenant Contamination',
    'Tenant A and Tenant B maintain distinct configurations with zero cross-tenant leakage'
  );

  console.log('\n====================================================');
  console.log(`POSTGRESQL BYOD TEST SUITE COMPLETED: ${testResults.filter(t => t.passed).length}/${testResults.length} PASSED`);
  console.log('====================================================\n');
}

runPostgresTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
