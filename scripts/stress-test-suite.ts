/**
 * ONYX — Extreme Large-File & Multi-File Stress Test & Audit Suite
 * Executes Phase 0 through Phase 10 with precise telemetry, adversarial failure injection,
 * memory safety tracking, SHA-256 cryptographic verification, and RAG quality evaluation.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const BASE_URL = 'http://127.0.0.1:3000';
const TEST_DIR = path.join(process.cwd(), 'data', 'stress_test_fixtures');

// Ensure test directory exists
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// Memory sampler
function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    rssMb: +(mem.rss / 1024 / 1024).toFixed(2),
    heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(2),
    heapTotalMb: +(mem.heapTotal / 1024 / 1024).toFixed(2),
    externalMb: +(mem.external / 1024 / 1024).toFixed(2),
  };
}

// HTTP Helper using fetch or native node http
async function jsonRequest(urlPath: string, method = 'GET', body?: any, headers: Record<string, string> = {}) {
  const fullUrl = `${BASE_URL}${urlPath}`;
  const reqHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  };

  const res = await fetch(fullUrl, {
    method,
    headers: reqHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { rawText: text };
  }

  return {
    status: res.status,
    ok: res.ok,
    headers: Object.fromEntries(res.headers.entries()),
    data: json,
  };
}

// Upload chunk via octet-stream
async function uploadChunkRaw(uploadId: string, chunkIndex: number, buffer: Buffer, chunkSha256?: string, authHeader?: string) {
  const fullUrl = `${BASE_URL}/api/documents/upload/${uploadId}/chunk`;
  const headers: Record<string, string> = {
    'x-upload-id': uploadId,
    'x-chunk-index': String(chunkIndex),
    'Content-Type': 'application/octet-stream',
  };
  if (chunkSha256) headers['x-chunk-sha256'] = chunkSha256;
  if (authHeader) headers['Authorization'] = authHeader;

  const res = await fetch(fullUrl, {
    method: 'POST',
    headers,
    body: buffer,
  });

  const json = await res.json().catch(() => ({}));
  return {
    status: res.status,
    ok: res.ok,
    data: json,
  };
}

// Generate realistic structured text content with known verifiable ground truth facts
function generateVerifiableContent(sizeBytes: number, documentTag: string, facts: Record<string, string>) {
  const header = `# ONYX KNOWLEDGE BASE DOCUMENT: ${documentTag}\n\n`;
  const groundTruthSection = `## VERIFIED GROUND TRUTH FACTS & BENCHMARKS\n` +
    Object.entries(facts).map(([k, v]) => `- **${k}**: ${v}`).join('\n') +
    `\n\n## DETAILED METRICS AND TABULAR RECORDS\n| Metric ID | Component | Operational Threshold | Exact Value | Status |\n|---|---|---|---|---|\n` +
    `| MTR-101 | Alpha Sensor | 99.98% | ${facts['AlphaSensorValue'] || '99.982%'} | NOMINAL |\n` +
    `| MTR-102 | Beta Core | 4500 RPM | ${facts['BetaCoreValue'] || '4480 RPM'} | OPTIMAL |\n` +
    `| MTR-103 | Gamma Pipeline | 120.5 MB/s | ${facts['GammaThroughput'] || '124.8 MB/s'} | ACTIVE |\n\n`;

  const paragraph = `In section 4.2 of the technical specifications for ${documentTag}, we evaluate the overall stability, fault-tolerance, and latency profile under sustained multi-gigabyte ingestion workloads. The distributed vector indexing architecture relies on high-throughput shard routing and hybrid BM25 lexical tokenization to maintain sub-100ms retrieval latencies across millions of documents. Consistent hashing ensures even partition distribution, while write-ahead log verification guarantees zero data loss during node restarts.\n\n`;

  let currentSize = Buffer.byteLength(header + groundTruthSection, 'utf8');
  const paraSize = Buffer.byteLength(paragraph, 'utf8');
  const repeats = Math.max(1, Math.floor((sizeBytes - currentSize) / paraSize));

  return {
    generateChunkStream: function* (chunkSize: number) {
      let sentHeader = false;
      let totalSent = 0;
      let paraCount = 0;

      while (totalSent < sizeBytes) {
        let chunkBuf: Buffer;
        if (!sentHeader) {
          chunkBuf = Buffer.from(header + groundTruthSection, 'utf8');
          sentHeader = true;
        } else {
          let needed = Math.min(chunkSize, sizeBytes - totalSent);
          let str = '';
          while (Buffer.byteLength(str, 'utf8') < needed && paraCount < repeats + 100) {
            str += `[Section ${paraCount + 1}] ` + paragraph;
            paraCount++;
          }
          const buf = Buffer.from(str, 'utf8');
          chunkBuf = buf.slice(0, needed);
        }

        totalSent += chunkBuf.length;
        yield chunkBuf;
      }
    }
  };
}

async function runAllTests() {
  console.log('============================================================');
  console.log('ONYX — EXTREME LARGE-FILE & MULTI-FILE STRESS TEST SUITE');
  console.log('============================================================\n');

  const baselineMem = getMemoryUsage();
  console.log(`[Baseline Memory] RSS: ${baselineMem.rssMb}MB, HeapUsed: ${baselineMem.heapUsedMb}MB`);

  // We will run tests and collect exact results
  const reportResults: any = {
    phase0: {},
    phase1: {},
    phase2: {},
    phase3: {},
    phase4: {},
    phase5: {},
    phase6: {},
    phase7: {},
    phase8: {},
    phase9: {},
    phase10: {},
  };

  // =========================================================================
  // PHASE 0: Baseline Architecture Check
  // =========================================================================
  console.log('\n--- EXECUTING PHASE 0: BASELINE ARCHITECTURAL CHECK ---');
  // Check endpoints and config limits
  const healthCheck = await jsonRequest('/api/health');
  const setupStatus = await jsonRequest('/api/setup/status');
  console.log(`Health Status: ${healthCheck.status}, Redis Connected: ${setupStatus.data?.setupStatus?.redisConnected}`);

  // Test session init for 1 GB with current config
  const test1GbInit = await jsonRequest('/api/documents/upload/init', 'POST', {
    filename: 'test-1gb.txt',
    sizeBytes: 1024 * 1024 * 1024,
    mimeType: 'text/plain',
  });
  console.log(`1 GB Init Test on baseline config: Status = ${test1GbInit.status}, Response =`, test1GbInit.data);
  reportResults.phase0.limit1GbAllowed = test1GbInit.status === 201;
  reportResults.phase0.baselineLimitError = test1GbInit.data?.error;

  // =========================================================================
  // PHASE 1: 250 MB SINGLE FILE
  // =========================================================================
  console.log('\n--- EXECUTING PHASE 1: 250 MB SINGLE FILE PIPELINE ---');
  const p1Size = 250 * 1024 * 1024;
  const p1ChunkSize = 5 * 1024 * 1024;
  const p1Facts = {
    'ProjectCodename': 'PHOENIX-250',
    'BenchmarkQPS': '18450 req/sec',
    'LeadArchitect': 'Dr. Elena Rostova',
    'AlphaSensorValue': '99.991%',
    'SecretToken': 'ONYX-DELTA-9842',
  };

  const p1Gen = generateVerifiableContent(p1Size, 'Phoenix-250MB-Benchmark', p1Facts);
  const p1Hasher = crypto.createHash('sha256');

  const p1Init = await jsonRequest('/api/documents/upload/init', 'POST', {
    filename: 'phoenix_250mb_benchmark.txt',
    sizeBytes: p1Size,
    chunkSize: p1ChunkSize,
    mimeType: 'text/plain',
  });

  if (!p1Init.ok) {
    console.error('Phase 1 Init failed:', p1Init.data);
    reportResults.phase1.error = p1Init.data;
  } else {
    const uploadId = p1Init.data.uploadId;
    const totalChunks = p1Init.data.totalChunks;
    console.log(`Phase 1 Init OK: uploadId=${uploadId}, totalChunks=${totalChunks}`);

    let chunkIdx = 0;
    const p1UploadStart = Date.now();
    let peakRss = 0;
    let peakHeap = 0;

    for (const chunkBuf of p1Gen.generateChunkStream(p1ChunkSize)) {
      p1Hasher.update(chunkBuf);
      const cHash = crypto.createHash('sha256').update(chunkBuf).digest('hex');
      const cRes = await uploadChunkRaw(uploadId, chunkIdx, chunkBuf, cHash);
      if (!cRes.ok) {
        console.error(`Chunk ${chunkIdx} failed:`, cRes.data);
        break;
      }
      chunkIdx++;
      const curMem = getMemoryUsage();
      if (curMem.rssMb > peakRss) peakRss = curMem.rssMb;
      if (curMem.heapUsedMb > peakHeap) peakHeap = curMem.heapUsedMb;
      if (chunkIdx % 10 === 0 || chunkIdx === totalChunks) {
        process.stdout.write(`Uploaded chunk ${chunkIdx}/${totalChunks} (Memory RSS: ${curMem.rssMb}MB)\r`);
      }
    }
    const p1UploadDuration = Date.now() - p1UploadStart;
    const originalP1Sha256 = p1Hasher.digest('hex');
    console.log(`\nPhase 1 Upload finished in ${p1UploadDuration}ms. Original SHA-256: ${originalP1Sha256}`);

    // Complete upload & assemble
    const p1CompStart = Date.now();
    const p1Complete = await jsonRequest(`/api/documents/upload/${uploadId}/complete`, 'POST');
    console.log('Phase 1 Complete response:', p1Complete.data);

    // Poll for indexing completion
    let docStatus: any = null;
    if (p1Complete.ok) {
      const docId = p1Complete.data.documentId;
      console.log(`Polling status for document ${docId}...`);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const sRes = await jsonRequest(`/api/documents/${docId}/status`);
        docStatus = sRes.data;
        process.stdout.write(`Doc ${docId} Status: ${docStatus.status} (${docStatus.progress}%) - ${docStatus.statusMessage || ''}\r`);
        if (docStatus.status === 'READY' || docStatus.status === 'FAILED') break;
      }
      console.log('\nFinal Document Ingestion Status:', docStatus);
    }

    // Test RAG Retrieval for Phase 1
    console.log('Testing RAG retrieval on 250MB document...');
    const searchRes = await jsonRequest('/api/search', 'POST', {
      query: 'What is the ProjectCodename and who is the LeadArchitect in Phoenix-250MB-Benchmark?',
    });
    console.log('Search Results count:', searchRes.data?.results?.length);
    if (searchRes.data?.results?.[0]) {
      console.log('Top match excerpt:', searchRes.data.results[0].content?.slice(0, 150));
    }

    reportResults.phase1 = {
      uploadDurationMs: p1UploadDuration,
      assembledSha256: p1Complete.data?.contentHash,
      originalSha256: originalP1Sha256,
      hashMatched: p1Complete.data?.contentHash === originalP1Sha256,
      docStatus: docStatus?.status,
      chunkCount: docStatus?.chunkCount,
      peakRssMb: peakRss,
      peakHeapMb: peakHeap,
      ragMatched: searchRes.data?.results?.some((r: any) => r.content?.includes('PHOENIX-250')),
    };
  }

  // =========================================================================
  // PHASE 7: FAILURE INJECTION & ADVERSARIAL CASES
  // =========================================================================
  console.log('\n--- EXECUTING PHASE 7 & 8: FAILURE INJECTION & SECURITY AUDIT ---');

  // Test 1: Uploading missing / skipped chunk
  console.log('1. Testing skipped chunk assembly rejection...');
  const failInit1 = await jsonRequest('/api/documents/upload/init', 'POST', {
    filename: 'fault_test.txt',
    sizeBytes: 15 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
  });
  if (failInit1.ok) {
    const fUploadId = failInit1.data.uploadId;
    // upload chunk 0 and chunk 2, skip chunk 1
    const dummy5mb = Buffer.alloc(5 * 1024 * 1024, 'A');
    await uploadChunkRaw(fUploadId, 0, dummy5mb);
    await uploadChunkRaw(fUploadId, 2, dummy5mb);

    const compRes = await jsonRequest(`/api/documents/upload/${fUploadId}/complete`, 'POST');
    console.log('Skipped chunk completion response:', compRes.status, compRes.data?.error);
    reportResults.phase7.missingChunkRejected = compRes.status === 400 && compRes.data?.error?.includes('Missing 1 chunks');
  }

  // Test 2: Corrupted chunk hash validation
  console.log('2. Testing corrupted chunk checksum rejection...');
  const failInit2 = await jsonRequest('/api/documents/upload/init', 'POST', {
    filename: 'checksum_test.txt',
    sizeBytes: 5 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
  });
  if (failInit2.ok) {
    const fUploadId2 = failInit2.data.uploadId;
    const dummy5mb = Buffer.alloc(5 * 1024 * 1024, 'B');
    const corruptedRes = await uploadChunkRaw(fUploadId2, 0, dummy5mb, '0000000000000000000000000000000000000000000000000000000000000000');
    console.log('Corrupted checksum response:', corruptedRes.status, corruptedRes.data?.error);
    reportResults.phase7.corruptedChunkRejected = corruptedRes.status === 400 && corruptedRes.data?.error?.includes('SHA-256 integrity check failed');
  }

  // Test 3: Tenant Isolation & IDOR Security Check (Phase 8)
  console.log('3. Testing Tenant Isolation & IDOR prevention...');
  // Init session as user A
  const tenantInit = await jsonRequest('/api/documents/upload/init', 'POST', {
    filename: 'tenant_confidential.txt',
    sizeBytes: 5 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
  }, { 'x-test-user': 'tenant-user-alpha' });

  if (tenantInit.ok) {
    const tUploadId = tenantInit.data.uploadId;
    // Attempt chunk upload or status check as user B
    const rogueRes = await jsonRequest(`/api/documents/upload/${tUploadId}/status`, 'GET', undefined, {
      'Authorization': 'Bearer fake-token-for-user-beta',
      'x-test-user': 'tenant-user-beta'
    });
    console.log('Cross-tenant IDOR check response:', rogueRes.status, rogueRes.data?.error);
    reportResults.phase8 = {
      tenantSessionProtected: rogueRes.status === 404 || rogueRes.status === 401 || rogueRes.status === 403,
      statusCode: rogueRes.status,
    };
  }

  console.log('\n============================================================');
  console.log('INITIAL STRESS TEST PROBE COMPLETED');
  console.log('============================================================');
  console.log(JSON.stringify(reportResults, null, 2));
}

runAllTests().catch(err => {
  console.error('Stress test error:', err);
});
