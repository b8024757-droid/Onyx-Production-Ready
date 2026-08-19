/**
 * Automated Regression Test Suite for Document Indexing & Ingestion Performance
 */

import { dbService } from '../server/db/database';
import { ingestionService } from '../server/services/ingestion-service';
import { embeddingService } from '../server/services/embedding-service';
import { vectorService } from '../server/services/vector-service';
import { keywordService } from '../server/services/keyword-service';
import { storageService } from '../server/storage/storage-service';

async function runRegressionTests() {
  console.log('================================================================');
  console.log('  ONYX DOCUMENT INDEXING REGRESSION & PERFORMANCE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
      failed++;
    }
  }

  // Test 1: Embedding Concurrency and Dimension Consistency
  console.log('\n--- TEST 1: Embedding Batching & Vector Dimensions ---');
  const sampleTexts = [
    'Distributed systems ensure consistency through consensus protocols.',
    'Vector search utilizes approximate nearest neighbors for fast retrieval.',
    'Hybrid search combines BM25 keyword frequency with neural dense embeddings.',
    'Reciprocal rank fusion harmonizes disparate scoring distributions.',
  ];
  const t0 = Date.now();
  const embeddings = await embeddingService.embedBatch(sampleTexts);
  const embedTimeMs = Date.now() - t0;

  assert(embeddings.length === 4, 'All 4 sample texts produced embeddings');
  assert(embeddings.every(vec => vec.length === 768), 'All vectors have correct 768 dimension');
  assert(embedTimeMs < 3000, `Batch embedding completed quickly (${embedTimeMs}ms < 3000ms)`);

  // Test 2: Ingestion Service Full Flow with Metrics
  console.log('\n--- TEST 2: Ingestion Pipeline & Telemetry Metrics ---');
  const testDocText = `# Systems Engineering Guide\n\nChapter 1: Fault Isolation\nFault isolation ensures subsystems fail independently.\n\nChapter 2: Graceful Degradation\nWhen downstream services throttle, fallbacks preserve core availability.`;
  const buffer = Buffer.from(testDocText, 'utf-8');

  const { jobId, documentId } = await ingestionService.submitDocumentForIngestion(
    'engineering-guide.md',
    buffer,
    'text/markdown',
    { userId: 'user-regression-test-1' }
  );

  assert(Boolean(jobId && documentId), 'Job and Document IDs generated successfully');

  // Allow queue to process
  let doc = await dbService.getDocumentById(documentId, 'user-regression-test-1');
  let retries = 0;
  while ((!doc || doc.status !== 'READY') && retries < 20) {
    await new Promise(r => setTimeout(r, 200));
    doc = await dbService.getDocumentById(documentId, 'user-regression-test-1');
    retries++;
  }

  assert(doc?.status === 'READY', `Document reached READY status (status: ${doc?.status})`);
  assert(Boolean(doc?.metrics), 'Document contains microsecond stage metrics');
  assert((doc?.chunkCount || 0) > 0, `Chunks were created (${doc?.chunkCount} chunks)`);
  assert(Boolean(doc?.contentHash), `SHA-256 content hash was recorded: ${doc?.contentHash?.slice(0, 12)}...`);

  // Test 3: Instant Deduplication Detection
  console.log('\n--- TEST 3: Duplicate Document Detection & Instant Recall ---');
  const tDupStart = Date.now();
  const dupResult = await ingestionService.submitDocumentForIngestion(
    'engineering-guide-duplicate.md',
    buffer,
    'text/markdown',
    { userId: 'user-regression-test-1' }
  );

  let dupDoc = await dbService.getDocumentById(dupResult.documentId, 'user-regression-test-1');
  retries = 0;
  while ((!dupDoc || dupDoc.status !== 'READY') && retries < 20) {
    await new Promise(r => setTimeout(r, 200));
    dupDoc = await dbService.getDocumentById(dupResult.documentId, 'user-regression-test-1');
    retries++;
  }

  const dupTotalTimeMs = Date.now() - tDupStart;
  assert(dupDoc?.status === 'READY', 'Duplicate document indexed successfully');
  assert(dupDoc?.metrics?.deduplicated === true, 'Duplicate was recognized and deduplicated');
  assert(dupTotalTimeMs < 1000, `Deduplicated document processed near-instantly (${dupTotalTimeMs}ms < 1000ms)`);

  // Test 4: Tenant Isolation (User 2 should not see User 1's documents)
  console.log('\n--- TEST 4: Tenant Isolation Integrity ---');
  const user2Doc = await dbService.getDocumentById(documentId, 'user-regression-test-2');
  assert(user2Doc === null, 'Tenant isolation prevents User 2 from accessing User 1 document');

  const user2Chunks = await dbService.getChunksForDocument(documentId, 'user-regression-test-2');
  assert(user2Chunks.length === 0, 'Tenant isolation prevents User 2 from accessing User 1 chunks');

  // Test 5: Keyword & Vector Search on Indexed Document
  console.log('\n--- TEST 5: Keyword and Vector Retrieval Quality ---');
  const kwResults = await keywordService.search({
    query: 'fault isolation',
    limit: 3,
    filter: { userId: 'user-regression-test-1' },
  });
  assert(kwResults.length > 0, `Keyword search found ${kwResults.length} matching passages`);
  assert(kwResults[0].content.toLowerCase().includes('fault isolation'), 'BM25 retrieved relevant content snippet');

  console.log('\n================================================================');
  console.log(`  REGRESSION RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests().catch(err => {
  console.error('Regression tests crashed:', err);
  process.exit(1);
});
