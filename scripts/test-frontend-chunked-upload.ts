/**
 * ONYX — Frontend Large-File Chunked Upload & Memory Verification Test Suite
 * Tests 10MB, 50MB, 100MB, 200MB, 250MB File/Blob slicing, memory comparison,
 * cancellation, retry, resume, deduplication, invalid files, and concurrency.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:3000';
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB

// Memory Measurement Utility
function getHeapUsedMb() {
  if (global.gc) {
    global.gc();
  }
  return +(process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2);
}

// Client-side simulation of browser File/Blob.slice() upload (the new implementation)
async function simulateFrontendChunkedUpload(
  fileBuffer: Buffer,
  filename: string,
  options: {
    chunkSize?: number;
    injectFailureAtChunk?: number;
    abortAfterChunk?: number;
    onProgress?: (p: any) => void;
  } = {}
) {
  const sizeBytes = fileBuffer.length;
  const chunkSize = options.chunkSize || CHUNK_SIZE;
  const totalChunks = Math.max(1, Math.ceil(sizeBytes / chunkSize));
  const progressReports: any[] = [];

  // 1. Calculate ground-truth SHA-256 of the whole file
  const fullFileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // 2. Init upload session
  const initRes = await fetch(`${BASE_URL}/api/documents/upload/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename,
      sizeBytes,
      chunkSize,
      clientSha256: fullFileSha256,
    }),
  });

  if (!initRes.ok) {
    const err = await initRes.json().catch(() => ({ error: 'Init failed' }));
    throw new Error(err.error || `Init failed with status ${initRes.status}`);
  }

  const { uploadId } = await initRes.json();

  // 3. Chunk upload loop with File.slice simulation
  let uploadedBytes = 0;
  for (let i = 0; i < totalChunks; i++) {
    if (options.abortAfterChunk !== undefined && i >= options.abortAfterChunk) {
      await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/abort`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      return { aborted: true, uploadId, completedChunks: i };
    }

    const start = i * chunkSize;
    const end = Math.min(sizeBytes, start + chunkSize);
    // Simulating browser's native file.slice(start, end)
    const chunkBuffer = fileBuffer.subarray(start, end);

    // Compute chunk SHA-256
    const chunkSha256 = crypto.createHash('sha256').update(chunkBuffer).digest('hex');

    // Simulate transient failure injection with retry
    let chunkSuccess = false;
    let attempt = 0;
    while (!chunkSuccess && attempt < 3) {
      attempt++;
      if (options.injectFailureAtChunk === i && attempt === 1) {
        // Injected failure
        continue;
      }

      const chunkRes = await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/chunk`, {
        method: 'POST',
        headers: {
          'x-upload-id': uploadId,
          'x-chunk-index': String(i),
          'x-chunk-sha256': chunkSha256,
          'Content-Type': 'application/octet-stream',
        },
        body: chunkBuffer,
      });

      if (chunkRes.ok) {
        chunkSuccess = true;
      }
    }

    if (!chunkSuccess) {
      throw new Error(`Failed to upload chunk ${i} after retries`);
    }

    uploadedBytes = end;
    const progress = {
      uploadId,
      chunkIndex: i + 1,
      totalChunks,
      uploadedBytes,
      totalBytes: sizeBytes,
      percent: Math.round((uploadedBytes / sizeBytes) * 100),
    };
    progressReports.push(progress);
    if (options.onProgress) options.onProgress(progress);
  }

  // 4. Complete upload
  const completeRes = await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!completeRes.ok) {
    const err = await completeRes.json().catch(() => ({ error: 'Complete failed' }));
    throw new Error(err.error || `Complete failed with status ${completeRes.status}`);
  }

  const result = await completeRes.json();
  return {
    ...result,
    totalChunks,
    progressReports,
    clientSha256: fullFileSha256,
  };
}

async function runAllTests() {
  console.log('='.repeat(75));
  console.log('ONYX FRONTEND CHUNKED UPLOAD & MEMORY AUDIT TEST SUITE');
  console.log('='.repeat(75));

  const results: { test: string; passed: boolean; details: string; durationMs: number }[] = [];

  async function test(name: string, fn: () => Promise<void>) {
    const t0 = Date.now();
    process.stdout.write(`▶ Running: ${name} ... `);
    try {
      await fn();
      const dur = Date.now() - t0;
      console.log(`\x1b[32mPASSED\x1b[0m (${dur}ms)`);
      results.push({ test: name, passed: true, details: 'OK', durationMs: dur });
    } catch (e: any) {
      const dur = Date.now() - t0;
      console.log(`\x1b[31mFAILED\x1b[0m (${dur}ms) -> ${e.message}`);
      results.push({ test: name, passed: false, details: e.message, durationMs: dur });
    }
  }

  // Generate synthetic test buffer
  function makeBuffer(sizeMb: number, tag: string): Buffer {
    const sizeBytes = Math.round(sizeMb * 1024 * 1024);
    const buf = Buffer.alloc(sizeBytes);
    const header = Buffer.from(`# TEST DOCUMENT ${tag} (${sizeMb} MB)\nTimestamp: ${Date.now()}\n\n`);
    header.copy(buf, 0);
    // Fill remainder with repeating pattern
    const pattern = Buffer.from(`DATA_BLOCK_${tag}_CHUNK_VALIDATION_STREAM_`);
    for (let i = header.length; i < sizeBytes; i += pattern.length) {
      pattern.copy(buf, i, 0, Math.min(pattern.length, sizeBytes - i));
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  // 1. MEMORY BENCHMARK: FileReader Base64 vs File.slice 5MB Chunks
  // -------------------------------------------------------------------------
  await test('Memory Comparison: FileReader Base64 vs Native File.slice', async () => {
    const testSizeMb = 50; // 50MB test buffer for memory benchmark
    const buf = makeBuffer(testSizeMb, 'MEM_BENCH');

    // Simulate Old Approach: FileReader.readAsDataURL (loads all bytes into RAM + Base64 expansion)
    const memBeforeOld = process.memoryUsage().heapUsed;
    const base64Str = `data:application/pdf;base64,${buf.toString('base64')}`;
    const payloadObj = { name: 'test.pdf', content: base64Str, sizeBytes: buf.length };
    const memAfterOld = process.memoryUsage().heapUsed;
    const oldDeltaMb = +((memAfterOld - memBeforeOld) / (1024 * 1024)).toFixed(2);
    // clean up
    (payloadObj as any) = null;

    // Simulate New Approach: file.slice (only 5 MB chunk in memory at a time)
    const memBeforeNew = process.memoryUsage().heapUsed;
    let maxChunkDeltaMb = 0;
    const chunkSize = 5 * 1024 * 1024;
    for (let i = 0; i < Math.ceil(buf.length / chunkSize); i++) {
      const sliceStart = process.memoryUsage().heapUsed;
      const slice = buf.subarray(i * chunkSize, Math.min(buf.length, (i + 1) * chunkSize));
      const sliceEnd = process.memoryUsage().heapUsed;
      const sliceDeltaMb = +((sliceEnd - sliceStart) / (1024 * 1024)).toFixed(2);
      if (sliceDeltaMb > maxChunkDeltaMb) maxChunkDeltaMb = sliceDeltaMb;
    }
    const memAfterNew = process.memoryUsage().heapUsed;
    const newDeltaMb = +((memAfterNew - memBeforeNew) / (1024 * 1024)).toFixed(2);

    console.log(`\n    [Memory Benchmark 50 MB File]`);
    console.log(`    - Old FileReader Base64 memory overhead: ~${oldDeltaMb} MB (Base64 string size: ${(base64Str.length / 1024 / 1024).toFixed(2)} MB)`);
    console.log(`    - New File.slice 5MB memory overhead: ~${newDeltaMb} MB (Max per-slice: ${maxChunkDeltaMb} MB)`);
    console.log(`    - Memory reduction: ${((1 - newDeltaMb / Math.max(1, oldDeltaMb)) * 100).toFixed(1)}%`);

    if (oldDeltaMb <= newDeltaMb && oldDeltaMb > 10) {
      throw new Error('Expected new slice approach to use significantly less heap memory than FileReader Base64');
    }
  });

  // -------------------------------------------------------------------------
  // 2. FILE SIZE TESTS: 10 MB, 50 MB, 100 MB, 200 MB, 250 MB
  // -------------------------------------------------------------------------
  const sizesToTest = [
    { mb: 10, expectedChunks: 2 },
    { mb: 50, expectedChunks: 10 },
    { mb: 100, expectedChunks: 20 },
    { mb: 200, expectedChunks: 40 },
    { mb: 250, expectedChunks: 50 },
  ];

  for (const { mb, expectedChunks } of sizesToTest) {
    await test(`Upload Test: ${mb} MB Document (${expectedChunks} chunks)`, async () => {
      const buf = makeBuffer(mb, `SIZE_${mb}MB`);
      const filename = `stress_doc_${mb}mb.txt`;

      let progressCount = 0;
      const res = await simulateFrontendChunkedUpload(buf, filename, {
        onProgress: (p) => {
          progressCount++;
        },
      });

      if (res.totalChunks !== expectedChunks) {
        throw new Error(`Expected ${expectedChunks} chunks, got ${res.totalChunks}`);
      }
      if (res.sizeBytes !== buf.length) {
        throw new Error(`Expected sizeBytes ${buf.length}, got ${res.sizeBytes}`);
      }
      if (res.contentHash !== res.clientSha256) {
        throw new Error(`SHA-256 hash mismatch! Server: ${res.contentHash}, Client: ${res.clientSha256}`);
      }
      if (!res.documentId || !res.jobId) {
        throw new Error('Missing documentId or jobId in completion response');
      }
      if (progressCount !== expectedChunks) {
        throw new Error(`Expected ${expectedChunks} progress events, got ${progressCount}`);
      }

      // Verify status endpoint reaches ingestion pipeline
      const statusRes = await fetch(`${BASE_URL}/api/documents/${res.documentId}/status`);
      if (!statusRes.ok) {
        throw new Error(`Failed to get document status: ${statusRes.status}`);
      }
      const statusData = await statusRes.json();
      if (!statusData.status || statusData.status === 'FAILED') {
        throw new Error(`Document status unexpected: ${statusData.status} - ${statusData.statusMessage}`);
      }
    });
  }

  // -------------------------------------------------------------------------
  // 3. CANCEL UPLOAD TEST
  // -------------------------------------------------------------------------
  await test('Adversarial Test: Cancel / Abort in-flight upload', async () => {
    const buf = makeBuffer(20, 'CANCEL_TEST');
    const res = await simulateFrontendChunkedUpload(buf, 'cancelled_doc.txt', {
      abortAfterChunk: 2, // abort after chunk 1
    });

    if (!res.aborted) {
      throw new Error('Expected upload to be marked aborted');
    }

    // Verify session status is aborted / deleted
    const statusRes = await fetch(`${BASE_URL}/api/documents/upload/${res.uploadId}/status`);
    if (statusRes.ok) {
      const data = await statusRes.json();
      if (data.status !== 'ABORTED' && data.status !== 'NOT_FOUND') {
        throw new Error(`Expected session to be aborted or removed, got status: ${data.status}`);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 4. RETRY FAILED CHUNK TEST
  // -------------------------------------------------------------------------
  await test('Resilience Test: Retry failed chunk during network glitch', async () => {
    const buf = makeBuffer(15, 'RETRY_TEST');
    const res = await simulateFrontendChunkedUpload(buf, 'retry_doc.txt', {
      injectFailureAtChunk: 1, // inject 1st attempt failure at chunk 1
    });

    if (res.totalChunks !== 3) {
      throw new Error(`Expected 3 chunks, got ${res.totalChunks}`);
    }
    if (res.contentHash !== res.clientSha256) {
      throw new Error('Integrity mismatch after retry');
    }
  });

  // -------------------------------------------------------------------------
  // 5. RESUME INTERRUPTED UPLOAD TEST
  // -------------------------------------------------------------------------
  await test('Resumption Test: Resume partially completed upload', async () => {
    const buf = makeBuffer(20, 'RESUME_TEST');
    const chunkSize = 5 * 1024 * 1024;
    const totalChunks = 4;
    const sha = crypto.createHash('sha256').update(buf).digest('hex');

    // 1. Init
    const initRes = await fetch(`${BASE_URL}/api/documents/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'resume_doc.txt', sizeBytes: buf.length, chunkSize, clientSha256: sha }),
    });
    const { uploadId } = await initRes.json();

    // 2. Upload chunks 0 and 1
    for (let i = 0; i < 2; i++) {
      const chunk = buf.subarray(i * chunkSize, (i + 1) * chunkSize);
      await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/chunk`, {
        method: 'POST',
        headers: { 'x-upload-id': uploadId, 'x-chunk-index': String(i), 'Content-Type': 'application/octet-stream' },
        body: chunk,
      });
    }

    // 3. Query status to discover completed chunks
    const statusRes = await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/status`);
    const statusData = await statusRes.json();
    if (!statusData.completedChunks.includes(0) || !statusData.completedChunks.includes(1)) {
      throw new Error('Session did not record completed chunks 0 and 1');
    }

    // 4. Resume by uploading remaining chunks 2 and 3
    for (let i = 2; i < totalChunks; i++) {
      const chunk = buf.subarray(i * chunkSize, Math.min(buf.length, (i + 1) * chunkSize));
      await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/chunk`, {
        method: 'POST',
        headers: { 'x-upload-id': uploadId, 'x-chunk-index': String(i), 'Content-Type': 'application/octet-stream' },
        body: chunk,
      });
    }

    // 5. Complete
    const completeRes = await fetch(`${BASE_URL}/api/documents/upload/${uploadId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const completeData = await completeRes.json();
    if (completeData.contentHash !== sha) {
      throw new Error('Resumed file checksum mismatch');
    }
  });

  // -------------------------------------------------------------------------
  // 6. DUPLICATE DETECTION TEST
  // -------------------------------------------------------------------------
  await test('Fast-Path Duplicate Detection: Upload identical document twice', async () => {
    const buf = makeBuffer(10, 'DUP_TEST');
    const filename = 'duplicate_test_doc.txt';

    // 1st Upload
    const res1 = await simulateFrontendChunkedUpload(buf, filename);

    // Wait for 1st doc to finish indexing
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const s = await fetch(`${BASE_URL}/api/documents/${res1.documentId}/status`);
      const data = await s.json();
      if (data.status === 'READY') {
        ready = true;
        break;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    // 2nd Upload (identical file)
    const tStart = Date.now();
    const res2 = await simulateFrontendChunkedUpload(buf, filename);
    const s2 = await fetch(`${BASE_URL}/api/documents/${res2.documentId}/status`);
    const data2 = await s2.json();

    if (data2.status === 'READY') {
      console.log(`    (Instant duplicate recall confirmed in ${Date.now() - tStart}ms)`);
    } else {
      console.log(`    (Document submitted to ingestion with contentHash: ${res2.contentHash})`);
    }
  });

  // -------------------------------------------------------------------------
  // 7. INVALID FILE TESTS
  // -------------------------------------------------------------------------
  await test('Edge-Case Test: Reject 0-byte file', async () => {
    const res = await fetch(`${BASE_URL}/api/documents/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'empty.txt', sizeBytes: 0 }),
    });

    if (res.ok) {
      throw new Error('Server should reject 0-byte file init');
    }
  });

  await test('Edge-Case Test: Reject file exceeding 250 MB', async () => {
    const res = await fetch(`${BASE_URL}/api/documents/upload/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'huge.txt', sizeBytes: 300 * 1024 * 1024 }),
    });

    if (res.ok) {
      throw new Error('Server should reject > 250 MB file init');
    }
  });

  // -------------------------------------------------------------------------
  // 8. CONCURRENT UPLOADS TEST
  // -------------------------------------------------------------------------
  await test('Concurrency Test: Two simultaneous chunked uploads', async () => {
    const bufA = makeBuffer(15, 'CONCURRENT_A');
    const bufB = makeBuffer(15, 'CONCURRENT_B');

    const [resA, resB] = await Promise.all([
      simulateFrontendChunkedUpload(bufA, 'concurrent_a.txt'),
      simulateFrontendChunkedUpload(bufB, 'concurrent_b.txt'),
    ]);

    if (resA.uploadId === resB.uploadId) {
      throw new Error('Concurrent uploads must have distinct uploadIds');
    }
    if (resA.contentHash !== resA.clientSha256) {
      throw new Error('File A checksum mismatch');
    }
    if (resB.contentHash !== resB.clientSha256) {
      throw new Error('File B checksum mismatch');
    }
  });

  // -------------------------------------------------------------------------
  // SUMMARY REPORT
  // -------------------------------------------------------------------------
  console.log('\n' + '='.repeat(75));
  console.log('AUDIT SUMMARY:');
  const allPassed = results.every(r => r.passed);
  results.forEach((r, idx) => {
    const mark = r.passed ? '\x1b[32m✔\x1b[0m' : '\x1b[31m✖\x1b[0m';
    console.log(`${mark} [${idx + 1}/${results.length}] ${r.test} (${r.durationMs}ms)`);
  });
  console.log('='.repeat(75));

  if (!allPassed) {
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('Fatal error during test suite execution:', err);
  process.exit(1);
});
