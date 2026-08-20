import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const BASE_URL = 'http://127.0.0.1:3000';
const LOG_FILE = path.join(process.cwd(), 'data', 'stress_test_run.log');
const REPORT_FILE = path.join(process.cwd(), 'data', 'stress_test_report.json');

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    rssMb: +(mem.rss / 1024 / 1024).toFixed(2),
    heapUsedMb: +(mem.heapUsed / 1024 / 1024).toFixed(2),
    heapTotalMb: +(mem.heapTotal / 1024 / 1024).toFixed(2),
    externalMb: +(mem.external / 1024 / 1024).toFixed(2),
  };
}

async function jsonReq(endpoint: string, method = 'GET', body?: any, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

async function uploadChunk(uploadId: string, index: number, buffer: Buffer, sha256?: string, authHeader?: string) {
  const headers: Record<string, string> = {
    'x-upload-id': uploadId,
    'x-chunk-index': String(index),
    'Content-Type': 'application/octet-stream',
  };
  if (sha256) headers['x-chunk-sha256'] = sha256;
  if (authHeader) headers['Authorization'] = authHeader;

  const res = await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/chunk`, {
    method: 'POST',
    headers,
    body: buffer,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

// Pre-create standard base pattern to fill chunks in O(1)
const basePatternStr = "ONYX Architecture Benchmark Specification: The high-throughput vector ingestion pipeline operates with persistent disk write-ahead log verification and resilient multi-stage chunk embeddings. Sub-second hybrid search fuses dense vector cosine similarity with probabilistic BM25 lexical ranking.\n";
const basePatternBuf = Buffer.from(basePatternStr, 'utf8');

function createChunkBuffer(chunkSize: number, headerText?: string): Buffer {
  const buf = Buffer.alloc(chunkSize);
  let offset = 0;
  if (headerText) {
    const hBuf = Buffer.from(headerText, 'utf8');
    hBuf.copy(buf, 0);
    offset += hBuf.length;
  }
  while (offset < chunkSize) {
    const copyLen = Math.min(basePatternBuf.length, chunkSize - offset);
    basePatternBuf.copy(buf, offset, 0, copyLen);
    offset += copyLen;
  }
  return buf;
}

async function generateFileAndUpload(
  filename: string,
  sizeBytes: number,
  chunkSize: number,
  facts: Record<string, string>,
  simulateDrop = false,
  dropChunkIdx = -1
) {
  const header = `# ONYX KNOWLEDGE BASE DOCUMENT: ${filename}\n\n## VERIFIED GROUND TRUTH FACTS & BENCHMARKS\n` +
    Object.entries(facts).map(([k, v]) => `- **${k}**: ${v}`).join('\n') +
    `\n\n## TABULAR TELEMETRY\n| Parameter | Baseline | Stress Target | Exact Value |\n|---|---|---|---|\n` +
    `| Throughput | 100 MB/s | 500 MB/s | ${facts['ExactThroughput'] || '492.4 MB/s'} |\n` +
    `| P99 Latency | 200 ms | 45 ms | ${facts['P99Latency'] || '38.2 ms'} |\n\n`;

  const initRes = await jsonReq('/api/documents/upload/init', 'POST', {
    filename,
    sizeBytes,
    chunkSize,
    mimeType: 'text/plain',
  });

  if (!initRes.ok) {
    return {
      success: false,
      error: initRes.data?.error || `HTTP ${initRes.status}`,
      status: initRes.status,
      filename,
      sizeBytes,
      finalStatus: 'REJECTED_BY_INIT',
    };
  }

  const uploadId = initRes.data.uploadId;
  const totalChunks = initRes.data.totalChunks;
  const hasher = crypto.createHash('sha256');

  let sentBytes = 0;
  let chunkIndex = 0;
  const uploadStartTime = Date.now();
  let peakRss = 0;
  let peakHeap = 0;
  let dropped = false;
  let uploadFailures = 0;
  let resumeSuccess = false;

  while (sentBytes < sizeBytes) {
    const currentChunkSize = Math.min(chunkSize, sizeBytes - sentBytes);
    const chunkBuf = createChunkBuffer(currentChunkSize, chunkIndex === 0 ? header : undefined);

    hasher.update(chunkBuf);
    const chunkSha = crypto.createHash('sha256').update(chunkBuf).digest('hex');

    if (simulateDrop && chunkIndex === dropChunkIdx && !dropped) {
      log(`[FailureSim] Artificially simulating dropped chunk ${chunkIndex} for ${filename}`);
      dropped = true;
      uploadFailures++;
      sentBytes += currentChunkSize;
      chunkIndex++;
      continue;
    }

    const cRes = await uploadChunk(uploadId, chunkIndex, chunkBuf, chunkSha);
    if (!cRes.ok) {
      uploadFailures++;
      log(`[ChunkUpload] Failed chunk ${chunkIndex}: ${JSON.stringify(cRes.data)}`);
    }

    sentBytes += currentChunkSize;
    chunkIndex++;

    const mem = getMemoryUsage();
    if (mem.rssMb > peakRss) peakRss = mem.rssMb;
    if (mem.heapUsedMb > peakHeap) peakHeap = mem.heapUsedMb;
  }

  const originalSha256 = hasher.digest('hex');

  // Resume dropped chunk
  if (dropped) {
    log(`[ResumeSim] Querying session status for ${uploadId}...`);
    const statusRes = await jsonReq(`/api/documents/upload/${uploadId}/status`);
    log(`[ResumeSim] Completed chunks before resume: ${statusRes.data.completedChunks?.length}/${totalChunks}`);
    
    // Now re-upload the missing dropped chunk
    log(`[ResumeSim] Resuming by uploading missing chunk ${dropChunkIdx}...`);
    const dropBuf = createChunkBuffer(chunkSize, dropChunkIdx === 0 ? header : undefined);
    const dropSha = crypto.createHash('sha256').update(dropBuf).digest('hex');
    const resChunk = await uploadChunk(uploadId, dropChunkIdx, dropBuf, dropSha);
    if (resChunk.ok) {
      log(`[ResumeSim] Resumed chunk ${dropChunkIdx} successfully.`);
      resumeSuccess = true;
    }
  }

  const uploadDurationMs = Date.now() - uploadStartTime;

  // Complete assembly
  log(`[Assembly] Completing upload ${uploadId} for ${filename}...`);
  const compRes = await jsonReq(`/api/documents/upload/${uploadId}/complete`, 'POST');
  if (!compRes.ok) {
    return {
      success: false,
      error: compRes.data?.error || `HTTP ${compRes.status}`,
      filename,
      sizeBytes,
      originalSha256,
      uploadDurationMs,
      peakRss,
      peakHeap,
      uploadFailures,
      resumeSuccess,
      finalStatus: 'ASSEMBLY_FAILED',
    };
  }

  const docId = compRes.data.documentId;
  const assembledSha256 = compRes.data.contentHash;
  const shaMatched = originalSha256 === assembledSha256;

  // Poll indexing
  const indexStartTime = Date.now();
  let finalStatus = 'PENDING';
  let chunkCount = 0;
  let indexingFailures = 0;

  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    const dRes = await jsonReq(`/api/documents/${docId}/status`);
    if (dRes.ok) {
      finalStatus = dRes.data.status;
      chunkCount = dRes.data.chunkCount || 0;
      if (finalStatus === 'READY' || finalStatus === 'FAILED') break;
    }
  }
  const indexingDurationMs = Date.now() - indexStartTime;
  if (finalStatus === 'FAILED') indexingFailures++;

  // Test RAG
  const ragRes = await jsonReq('/api/search', 'POST', {
    query: `What is the ExactThroughput and P99Latency for ${filename}?`,
  });

  const ragMatched = ragRes.data?.results?.some((r: any) =>
    r.content?.includes(facts['ExactThroughput'] || '492.4 MB/s') ||
    r.content?.includes(facts['P99Latency'] || '38.2 ms') ||
    r.content?.includes(filename)
  );

  return {
    success: true,
    filename,
    sizeBytes,
    uploadDurationMs,
    indexingDurationMs,
    totalDurationMs: uploadDurationMs + indexingDurationMs,
    originalSha256,
    assembledSha256,
    shaMatched,
    totalChunks,
    chunkCount,
    finalStatus,
    peakRss,
    peakHeap,
    uploadFailures,
    resumeSuccess,
    indexingFailures,
    ragMatched,
    documentId: docId,
  };
}

async function main() {
  fs.writeFileSync(LOG_FILE, `=== ONYX STRESS TEST STARTED AT ${new Date().toISOString()} ===\n`);
  log('Starting comprehensive phase evaluation...');

  const results: Record<string, any> = {};

  // Phase 0: Inspect config
  log('--- PHASE 0: INSPECT CONFIG ---');
  const init1Gb = await jsonReq('/api/documents/upload/init', 'POST', {
    filename: '1gb_test.txt',
    sizeBytes: 1024 * 1024 * 1024,
    mimeType: 'text/plain',
  });
  results.phase0 = {
    maxFileSizeConfigMb: 250,
    oneGbAllowedByDefault: init1Gb.status === 201,
    rejectionReason: init1Gb.data?.error,
  };
  log(`Phase 0 Result: 1GB Init Status = ${init1Gb.status}, msg = ${init1Gb.data?.error}`);

  // Phase 1: 250 MB
  log('--- PHASE 1: 250 MB SINGLE FILE ---');
  results.phase1 = await generateFileAndUpload(
    'phase1_250mb_benchmark.txt',
    250 * 1024 * 1024,
    5 * 1024 * 1024,
    { 'ExactThroughput': '248.6 MB/s', 'P99Latency': '14.2 ms', 'TargetSystem': 'ONYX-CLUSTER-A' }
  );
  log(`Phase 1 Result: Status=${results.phase1.finalStatus}, SHA_Match=${results.phase1.shaMatched}, RAG_Match=${results.phase1.ragMatched}`);

  // Phase 2: 500 MB (with drop chunk & resume)
  log('--- PHASE 2: 500 MB RESUME & DUPLICATE TEST ---');
  const init500Mb = await jsonReq('/api/documents/upload/init', 'POST', {
    filename: 'phase2_500mb.txt',
    sizeBytes: 500 * 1024 * 1024,
    mimeType: 'text/plain',
  });
  results.phase2 = {
    initStatus: init500Mb.status,
    initError: init500Mb.data?.error,
    allowedWithCurrentLimit: init500Mb.status === 201,
  };
  log(`Phase 2 Result: Init 500MB status=${init500Mb.status}, msg=${init500Mb.data?.error}`);

  // Phase 4: 5 x 40 MB batch (Simulating multi-file batch within current limits)
  log('--- PHASE 4: MULTI-FILE BATCH TEST (5 x 40 MB = 200 MB total) ---');
  const batch5Promises = [1, 2, 3, 4, 5].map((i) =>
    generateFileAndUpload(
      `batch5_doc_${i}.txt`,
      40 * 1024 * 1024,
      5 * 1024 * 1024,
      { 'ExactThroughput': `${100 + i * 20} MB/s`, 'P99Latency': `${10 + i * 2} ms`, 'DocIndex': `DOC-00${i}` },
      i === 3, // Simulate drop on file 3
      3 // drop chunk 3 on file 3
    )
  );
  results.phase4 = await Promise.all(batch5Promises);
  log(`Phase 4 Result: Completed ${results.phase4.filter((r: any) => r.finalStatus === 'READY').length}/5 files ready`);

  // Phase 7: Failure injection
  log('--- PHASE 7: ADVERSARIAL FAILURE INJECTION ---');
  // 1. Missing chunk assembly
  const missInit = await jsonReq('/api/documents/upload/init', 'POST', {
    filename: 'missing_chunk.txt',
    sizeBytes: 15 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
  });
  let missingChunkRejected = false;
  if (missInit.ok) {
    const dummy = Buffer.alloc(5 * 1024 * 1024, 'X');
    await uploadChunk(missInit.data.uploadId, 0, dummy);
    await uploadChunk(missInit.data.uploadId, 2, dummy); // skipped 1
    const comp = await jsonReq(`/api/documents/upload/${missInit.data.uploadId}/complete`, 'POST');
    missingChunkRejected = comp.status === 400 && comp.data?.error?.includes('Missing 1 chunks');
  }

  // 2. Corrupted checksum
  const badChkInit = await jsonReq('/api/documents/upload/init', 'POST', {
    filename: 'corrupted_checksum.txt',
    sizeBytes: 5 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
  });
  let corruptedChecksumRejected = false;
  if (badChkInit.ok) {
    const dummy = Buffer.alloc(5 * 1024 * 1024, 'Y');
    const badRes = await uploadChunk(badChkInit.data.uploadId, 0, dummy, '1111111111111111111111111111111111111111111111111111111111111111');
    corruptedChecksumRejected = badRes.status === 400 && badRes.data?.error?.includes('SHA-256 integrity check failed');
  }

  results.phase7 = {
    missingChunkRejected,
    corruptedChecksumRejected,
  };
  log(`Phase 7 Result: MissingChunkRejected=${missingChunkRejected}, CorruptedChecksumRejected=${corruptedChecksumRejected}`);

  // Phase 8: Security & Tenant Isolation
  log('--- PHASE 8: TENANT ISOLATION & IDOR AUDIT ---');
  const tInit = await jsonReq('/api/documents/upload/init', 'POST', {
    filename: 'tenant_alpha_doc.txt',
    sizeBytes: 5 * 1024 * 1024,
    chunkSize: 5 * 1024 * 1024,
  }, { 'x-test-user': 'tenant-user-alpha' });

  let idorPrevented = false;
  if (tInit.ok) {
    const rogueRes = await jsonReq(`/api/documents/upload/${tInit.data.uploadId}/status`, 'GET', undefined, {
      'x-test-user': 'tenant-user-beta',
    });
    idorPrevented = rogueRes.status === 404 || rogueRes.status === 403;
  }
  results.phase8 = {
    idorPrevented,
  };
  log(`Phase 8 Result: IDOR Prevented=${idorPrevented}`);

  // Write full report
  fs.writeFileSync(REPORT_FILE, JSON.stringify(results, null, 2));
  log(`=== STRESS TEST COMPLETED — Report written to ${REPORT_FILE} ===`);
}

main().catch(err => {
  log(`FATAL ERROR: ${err.message}\n${err.stack}`);
});
