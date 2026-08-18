import { dbService } from '../server/db/database';
import { vectorService } from '../server/services/vector-service';
import { keywordService } from '../server/services/keyword-service';
import { embeddingService } from '../server/services/embedding-service';
import { rerankService } from '../server/services/rerank-service';
import { ContextService } from '../server/services/context-service';
import { queueService } from '../server/services/queue-service';
import { getGeminiClient } from '../server/gemini';
import { config } from '../server/config';
import IORedis from 'ioredis';
import { Queue } from 'bullmq';

async function main() {
  await dbService.init();
  await vectorService.init();
  await keywordService.rebuildIndex();

  console.log('=== 1. ALL DOCUMENTS IN DATABASE ===');
  const allDocs = await dbService.getDocuments();
  console.log(JSON.stringify(allDocs.map(d => ({
    id: d.id,
    title: d.title,
    originalName: d.originalName,
    sizeBytes: d.sizeBytes,
    status: d.status,
    chunkCount: d.chunkCount,
    createdAt: d.createdAt
  })), null, 2));

  const resumeDocs = allDocs.filter(d => 
    (d.title && d.title.toLowerCase().includes('mukilan')) || 
    (d.originalName && d.originalName.toLowerCase().includes('mukilan'))
  );

  console.log('\n=== 2. MATCHING RESUME DOCUMENTS ===');
  console.log(JSON.stringify(resumeDocs, null, 2));

  let resumeDocId = '';
  if (resumeDocs.length > 0) {
    resumeDocId = resumeDocs[0].id;
  }

  console.log('\n=== 3. CHUNKS FOR RESUME IN DATABASE ===');
  if (resumeDocId) {
    const chunks = await dbService.getChunksForDocument(resumeDocId);
    console.log(`Document ID: ${resumeDocId}`);
    console.log(`Chunk count: ${chunks.length}`);
    for (const c of chunks) {
      console.log(`Chunk [${c.id}] (index: ${c.chunkIndex}, page: ${c.pageNumber}): ${c.content.slice(0, 200)}...`);
    }
  } else {
    console.log('No document matching Mukilan found.');
  }

  console.log('\n=== 4. QDRANT VECTORS FOR RESUME ===');
  if (resumeDocId) {
    try {
      const qdrantPoints = await vectorService.search({
        vector: new Array(768).fill(0.01),
        limit: 100,
        filter: { documentId: resumeDocId }
      });
      console.log(`Qdrant vector count for docId ${resumeDocId}: ${qdrantPoints.length}`);
      console.log('Sample Qdrant points:', JSON.stringify(qdrantPoints.slice(0, 3), null, 2));
    } catch (e: any) {
      console.log('Error querying Qdrant for resume:', e.message);
    }
  }

  console.log('\n=== 5. ALL CHUNKS IN DATABASE & QDRANT ===');
  const allChunks = await dbService.getAllChunks();
  console.log(`Total chunks in DB across all docs: ${allChunks.length}`);
  console.log('Chunks grouped by document:');
  const chunksByDoc: Record<string, number> = {};
  for (const c of allChunks) {
    chunksByDoc[c.documentId] = (chunksByDoc[c.documentId] || 0) + 1;
  }
  console.log(JSON.stringify(chunksByDoc, null, 2));

  console.log('\n=== 6. BULLMQ / REDIS JOB & PERSISTED JOBS ===');
  const jobsInDb = await dbService.getRecentJobs(undefined, 20);
  console.log('Recent jobs in DB:', JSON.stringify(jobsInDb, null, 2));

  console.log('\n=== 7. CHAT CONVERSATIONS & RECENT MESSAGES ===');
  const convs = await dbService.getConversations();
  for (const c of convs) {
    const msgs = await dbService.getMessages(c.id);
    console.log(`\nConversation ID: ${c.id}, Title: "${c.title}", Messages count: ${msgs.length}`);
    for (const m of msgs) {
      console.log(`  [${m.role}] ${m.content.slice(0, 150)}`);
      if ((m as any).metrics) {
        console.log(`    Metrics:`, JSON.stringify((m as any).metrics));
      }
      if (m.citations) {
        console.log(`    Citations (${m.citations.length}):`, JSON.stringify(m.citations.map(cit => ({ docTitle: cit.documentTitle, excerpt: cit.excerpt.slice(0, 60) }))));
      }
    }
  }

  console.log('\n=== 8. SIMULATE QUERY: "what\'s his name" ===');
  const queryText = "what's his name";
  const tStart = Date.now();

  const tEmbed0 = Date.now();
  const queryVec = await embeddingService.embedText(queryText);
  const embedMs = Date.now() - tEmbed0;

  const tVec0 = Date.now();
  const vecHits = await vectorService.search({ vector: queryVec, limit: 10 });
  const vecMs = Date.now() - tVec0;

  const tBm25_0 = Date.now();
  const bm25Hits = await keywordService.search({ query: queryText, limit: 10 });
  const bm25Ms = Date.now() - tBm25_0;

  const tRrf0 = Date.now();
  const fused = rerankService.reciprocalRankFusion(vecHits, bm25Hits, { k: 60, topN: 6 });
  const rrfMs = Date.now() - tRrf0;

  const tRerank0 = Date.now();
  const reranked = await rerankService.neuralRerank(queryText, fused, 4);
  const rerankMs = Date.now() - tRerank0;

  const grounded = ContextService.buildGroundedContext(reranked, 3000);

  console.log(`Query: "${queryText}"`);
  console.log(`Embedding latency: ${embedMs}ms`);
  console.log(`Vector Hits (${vecHits.length}) in ${vecMs}ms:`, vecHits.map(h => ({ docId: h.documentId, title: h.payload.title, score: h.score, text: h.payload.content.slice(0, 60) })));
  console.log(`BM25 Hits (${bm25Hits.length}) in ${bm25Ms}ms:`, bm25Hits.map(h => ({ docId: h.documentId, title: h.title, score: h.score, text: h.content.slice(0, 60) })));
  console.log(`RRF Fused (${fused.length}) in ${rrfMs}ms:`, fused.map(h => ({ docId: h.documentId, title: h.title, score: h.finalScore, text: h.content.slice(0, 60) })));
  console.log(`Reranked (${reranked.length}) in ${rerankMs}ms:`, reranked.map(h => ({ docId: h.documentId, title: h.title, score: h.finalScore, text: h.content.slice(0, 60) })));
  console.log(`Grounded context citations count: ${grounded.citations.length}`);
  console.log(`Prompt Context preview:\n${grounded.promptContext}`);

  // Test Gemini generation timing
  const ai = getGeminiClient();
  if (ai) {
    const tGen0 = Date.now();
    let ttftMs = 0;
    let totalGenMs = 0;
    let fullAnswer = '';
    const stream = await ai.models.generateContentStream({
      model: config.gemini.textModel || 'gemini-3.7-flash',
      contents: `System: You are an analytical assistant. Cite passages as [[01]].\n\nPassages:\n${grounded.promptContext}\n\nQuestion: ${queryText}`,
      config: { temperature: 0.1 },
    });
    let isFirst = true;
    for await (const chunk of stream) {
      if (isFirst) {
        ttftMs = Date.now() - tGen0;
        isFirst = false;
      }
      fullAnswer += chunk.text || '';
    }
    totalGenMs = Date.now() - tGen0;
    console.log(`Gemini Generation: TTFT = ${ttftMs}ms, Total = ${totalGenMs}ms`);
    console.log(`Answer:\n${fullAnswer}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
