/**
 * ONYX RAG Retrieval & Summary Optimization Test Suite
 * Tests all 7 required query scenarios:
 * 1. Direct factual question
 * 2. Cross-section question
 * 3. Whole-document summary (exact failing prompt)
 * 4. Methodology question
 * 5. Results question
 * 6. Conclusion question
 * 7. Question with insufficient evidence
 */

import { rerankService } from '../server/services/rerank-service';
import { keywordService } from '../server/services/keyword-service';
import { dbService } from '../server/db/database';
import { ContextService } from '../server/services/context-service';
import { Chunk, Document } from '../src/types';

// Mock 45 semantic chunks simulating a 2MB indexed research paper
function setupMockPaper(): { documentId: string; chunks: Chunk[] } {
  const documentId = 'doc-research-paper-45';
  const userId = 'user-test-rag';

  const doc: Document = {
    id: documentId,
    title: 'Hybrid Sequential Modeling for Wearable Sensor Activity Recognition: An HMM and CRF Comparative Study',
    originalName: 'research-paper.pdf',
    type: 'PDF',
    sizeBytes: 2097152, // 2MB
    category: 'Documents',
    status: 'READY',
    progress: 100,
    chunkCount: 45,
    pageCount: 12,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    userId,
    tags: ['sensors', 'HMM', 'CRF', 'activity recognition'],
  };

  dbService.documents.set(documentId, doc);

  const rawSections = [
    // Pages 1-2: Abstract & Introduction (Chunks 1-8)
    { page: 1, section: 'Abstract', text: 'In this paper, we investigate sequence classification models for multimodal human activity recognition using wearable accelerometer and gyroscope sensors. We compare Hidden Markov Models (HMM) and Conditional Random Fields (CRF) under varying noise conditions.' },
    { page: 1, section: '1. Introduction', text: 'Wearable sensor technologies have enabled continuous physical activity tracking in healthcare and sports science. However, sequential dependencies between consecutive movements are challenging to model accurately with static classifiers.' },
    { page: 2, section: '1.1 Problem Statement', text: 'Traditional activity recognition pipelines fail during transitions between activities. The primary objective is establishing whether discriminative models like CRF outperform generative HMM frameworks on continuous inertial stream data.' },
    { page: 2, section: '1.2 Contributions', text: 'Our key contributions are: (1) A dataset of 30 subjects with 6-axis IMU sensors, (2) Direct empirical comparison of discrete HMM vs linear-chain CRF, (3) Robustness analysis under simulated sensor drift.' },
    { page: 2, section: '2. Related Work', text: 'Previous studies by Bao and Intille demonstrated accelerometer-based recognition. Subsequent works incorporated graphical models, but direct head-to-head evaluation on identical sensor benchmarks remains scarce.' },
    { page: 3, section: '2.1 Graphical Models Background', text: 'Hidden Markov Models assume generative joint distributions P(X, Y), whereas Conditional Random Fields estimate conditional distributions P(Y|X) directly, avoiding label bias issues.' },
    { page: 3, section: '2.2 Wearable Sensor Types', text: 'Modern inertial measurement units (IMUs) integrate 3-axis accelerometers measuring linear acceleration (in g) and 3-axis gyroscopes measuring angular velocity (in deg/s).' },
    { page: 3, section: '2.3 Preprocessing Pipeline', text: 'Raw sensor signals are sampled at 50 Hz, filtered with a 3rd-order low-pass Butterworth filter (cutoff 20 Hz), and segmented into 2.56-second sliding windows with 50% overlap.' },

    // Pages 4-6: Methodology & Mathematical Models (Chunks 9-18)
    { page: 4, section: '3. Methodology: Sequential Models', text: 'We formulate activity recognition as sequence labeling over observation sequence X = (x1, x2, ..., xT) and state sequence Y = (y1, y2, ..., yT), where states correspond to discrete physical activities.' },
    { page: 4, section: '3.1 Hidden Markov Model (HMM)', text: 'The HMM generative model defines joint probability P(X,Y) = P(y1) * prod(P(yt|yt-1)) * prod(P(xt|yt)). We evaluate both Gaussian Mixture emission models and discrete codebook emissions trained via Baum-Welch Expectation Maximization.' },
    { page: 5, section: '3.2 Conditional Random Field (CRF)', text: 'The linear-chain CRF models conditional probability P(Y|X) = (1/Z(X)) * exp(sum_t (sum_k lambda_k * f_k(yt-1, yt, X, t) + sum_j mu_j * g_j(yt, X, t))). Parameters are estimated via L-BFGS with L2 regularization.' },
    { page: 5, section: '3.3 Feature Extraction', text: 'From each 128-sample window, we extract 43 time-domain and frequency-domain features including mean, variance, signal magnitude area (SMA), dominant frequency, spectral energy, and inter-axis correlation.' },
    { page: 6, section: '3.4 Training and Regularization', text: 'To prevent overfitting, CRF models employ Gaussian prior variance sigma^2 = 1.0. Convergence is achieved when parameter updates delta < 1e-5. HMMs use Laplace smoothing on transition matrices.' },

    // Pages 6-8: Experimental Setup & Hardware (Chunks 19-27)
    { page: 6, section: '4. Experimental Setup', text: 'Experiments were conducted with 30 healthy human volunteers (18 male, 12 female, aged 22-38 years). Subjects performed a standardized protocol of 6 activities: walking, walking upstairs, walking downstairs, sitting, standing, and lying down.' },
    { page: 7, section: '4.1 Sensor Hardware & Placement', text: 'Subjects were equipped with three Shimmer3 IMU sensor nodes positioned at the dominant wrist, right hip (waist), and right ankle. Each node recorded tri-axial acceleration and angular velocity at 50 Hz.' },
    { page: 7, section: '4.2 Data Collection Protocol', text: 'Each session lasted 45 minutes per participant. Activities were video-recorded at 30 fps by an external synchronized camera to establish ground-truth timecode annotations.' },
    { page: 8, section: '4.3 Validation Scheme', text: 'We evaluated models using Leave-One-Subject-Out (LOSO) cross-validation across all 30 participants to measure generalization performance on unseen subjects.' },

    // Pages 8-10: Results & Empirical Findings (Chunks 28-36)
    { page: 8, section: '5. Major Results', text: 'On the overall 6-activity benchmark, Linear-Chain CRF achieved an average accuracy of 94.2% (F1-score 93.8%), significantly outperforming HMM which reached 86.4% accuracy (F1-score 85.1%).' },
    { page: 9, section: '5.1 Dynamic vs Static Activity Classification', text: 'For dynamic activities (walking, upstairs, downstairs), CRF scored 96.1% versus 84.7% for HMM. The discriminative loss function of CRF proved more capable of distinguishing transitional steps.' },
    { page: 9, section: '5.2 Postural Transition Analysis', text: 'Analyzing sit-to-stand and stand-to-sit transitions showed CRF maintained 89.4% precision compared to 71.2% for HMM, which suffered from state over-smoothing.' },
    { page: 10, section: '5.3 Sensor Placement Importance', text: 'Ablation experiments showed waist sensor provided 78.3% standalone accuracy, ankle sensor provided 72.1%, and wrist sensor provided 64.5%. Fusing all three sensor placements yielded the optimal 94.2%.' },

    // Pages 10-11: Discussion & Limitations (Chunks 37-41)
    { page: 10, section: '6. Discussion & Limitations', text: 'Despite strong performance, our study has several notable limitations: (1) Computational cost: CRF training required 14x more compute time than HMM, (2) Sensor placement sensitivity: Misalignment of the ankle node degraded accuracy by 8.4%, (3) Laboratory environment: Controlled protocols do not capture chaotic real-world daily behavior.' },
    { page: 11, section: '6.1 Energy Consumption Constraints', text: 'Real-time inference on microcontroller hardware (ARM Cortex-M4) drew 18.2 mW for CRF Viterbi decoding versus 6.4 mW for HMM, indicating trade-offs for battery-constrained wearable edge devices.' },

    // Pages 11-12: Conclusion & Future Work (Chunks 42-45)
    { page: 11, section: '7. Conclusion', text: 'In conclusion, this paper presented a comprehensive empirical comparison of HMM and CRF sequential modeling for wearable sensor activity recognition. CRF delivers superior 94.2% accuracy across 30 subjects with 3 IMU sensors.' },
    { page: 12, section: '7.1 Future Work', text: 'Future work will explore deep recurrent architectures (BiLSTM-CRF) and self-supervised contrastive learning to reduce annotation costs in continuous wearable health monitoring.' },
  ];

  const chunks: Chunk[] = rawSections.map((sec, i) => {
    const chunk: Chunk = {
      id: `chunk-paper-${i + 1}`,
      documentId,
      documentTitle: doc.title,
      content: sec.text,
      chunkIndex: i,
      tokenCount: 60,
      pageNumber: sec.page,
      sectionHeader: sec.section,
      userId,
      metadata: {
        pageNumber: sec.page,
        sectionHeader: sec.section,
      },
    };
    dbService.chunks.set(chunk.id, chunk);
    return chunk;
  });

  return { documentId, chunks };
}

async function runTests() {
  console.log('===========================================================');
  console.log('  ONYX RAG RETRIEVAL & SUMMARY BENCHMARK VERIFICATION');
  console.log('===========================================================');

  const { documentId } = setupMockPaper();
  await keywordService.rebuildIndex();
  let passedCount = 0;
  let totalCount = 7;

  // TEST 1: Direct Factual Question
  console.log('\n--- TEST 1: Direct Factual Question ---');
  {
    const query = 'What was the overall accuracy achieved by the Linear-Chain CRF model?';
    const kwHits = await keywordService.search({ query, limit: 10, filter: { documentId } });
    const rrfCandidates = rerankService.reciprocalRankFusion([], kwHits, { topN: 6 });
    const reranked = await rerankService.neuralRerank(query, rrfCandidates, 6, { skipNeural: true });
    const grounded = rerankService.filterGroundedCandidates(query, reranked);

    const hasCorrectFact = grounded.some(c => c.content.includes('94.2%') && c.content.includes('CRF'));
    console.log(`Query: "${query}"`);
    console.log(`Grounded Chunks: ${grounded.length}`);
    console.log(`Contains Factual Target (94.2% CRF): ${hasCorrectFact}`);
    if (grounded.length > 0 && hasCorrectFact) {
      console.log('✅ TEST 1 PASSED: Direct factual retrieval succeeded');
      passedCount++;
    } else {
      console.error('❌ TEST 1 FAILED');
    }
  }

  // TEST 2: Cross-Section Question
  console.log('\n--- TEST 2: Cross-Section Question ---');
  {
    const query = 'Compare the sensor hardware setup in the methodology with the resulting accuracy in the findings.';
    const intent = rerankService.detectQueryIntent(query);
    const kwHits = await keywordService.search({ query, limit: 20, filter: { documentId } });
    const rrfCandidates = rerankService.reciprocalRankFusion([], kwHits, { topN: 10 });
    const reranked = await rerankService.neuralRerank(query, rrfCandidates, 8, {
      skipNeural: true,
      isSummaryMode: intent.isSummaryOrCrossSection,
      facets: intent.facets,
    });
    const grounded = rerankService.filterGroundedCandidates(query, reranked, {
      isSummaryMode: intent.isSummaryOrCrossSection,
      intentAnalysis: intent,
    });

    const hasSensorEvidence = grounded.some(c => c.content.toLowerCase().includes('sensor') || c.content.toLowerCase().includes('imu'));
    const hasResultsEvidence = grounded.some(c => c.content.includes('accuracy') || c.content.includes('94.2%') || c.content.includes('86.4%'));
    console.log(`Query: "${query}"`);
    console.log(`Intent Detected: ${intent.intent}`);
    console.log(`Grounded Chunks: ${grounded.length}`);
    console.log(`Sensor Evidence Present: ${hasSensorEvidence}, Results Evidence Present: ${hasResultsEvidence}`);
    if (grounded.length >= 2 && hasSensorEvidence && hasResultsEvidence) {
      console.log('✅ TEST 2 PASSED: Cross-section multi-domain retrieval succeeded');
      passedCount++;
    } else {
      console.error('❌ TEST 2 FAILED');
    }
  }

  // TEST 3: Whole-Document Summary (Exact Failing User Query)
  console.log('\n--- TEST 3: Whole-Document Summary (Exact Failing User Query) ---');
  {
    const query = 'Summarize the entire paper in 5–7 sentences, including the experiment, sensors, HMM, CRF, major results, limitations, and conclusion.';
    const intent = rerankService.detectQueryIntent(query);
    console.log(`Query: "${query}"`);
    console.log(`Intent Detected: ${intent.intent} | isSummary: ${intent.isSummaryOrCrossSection}`);
    console.log(`Facets Identified: ${intent.facets.map(f => f.name).join(', ')}`);

    // Multi-facet retrieval expansion
    let allKwHits = await keywordService.search({ query, limit: 30, filter: { documentId } });
    const seenIds = new Set(allKwHits.map(h => h.chunkId));

    for (const facet of intent.facets) {
      const facetHits = await keywordService.search({ query: facet.subQuery, limit: 6, filter: { documentId } });
      for (const fh of facetHits) {
        if (!seenIds.has(fh.chunkId)) {
          seenIds.add(fh.chunkId);
          allKwHits.push(fh);
        }
      }
    }

    const rrfCandidates = rerankService.reciprocalRankFusion([], allKwHits, { topN: 16 });
    const reranked = await rerankService.neuralRerank(query, rrfCandidates, 10, {
      skipNeural: true,
      isSummaryMode: true,
      facets: intent.facets,
    });

    let diagnosticLog: any = null;
    const grounded = rerankService.filterGroundedCandidates(query, reranked, {
      isSummaryMode: true,
      intentAnalysis: intent,
      onDiagnostic: (diag) => {
        diagnosticLog = diag;
      },
    });

    const context = ContextService.buildGroundedContext(grounded, 3800);

    const hasIntro = grounded.some(c => c.sectionHeader?.includes('Introduction') || c.sectionHeader?.includes('Abstract'));
    const hasModels = grounded.some(c => c.content.includes('HMM') && c.content.includes('CRF'));
    const hasSensors = grounded.some(c => c.content.toLowerCase().includes('sensor') || c.content.toLowerCase().includes('imu'));
    const hasResults = grounded.some(c => c.content.includes('94.2%') || c.content.includes('accuracy'));
    const hasLimitations = grounded.some(c => c.content.toLowerCase().includes('limitations') || c.content.toLowerCase().includes('computational cost'));
    const hasConclusion = grounded.some(c => c.sectionHeader?.includes('Conclusion') || c.content.toLowerCase().includes('in conclusion'));

    console.log(`Grounded Chunks Count: ${grounded.length}`);
    console.log(`Diagnostic Status: ${diagnosticLog?.groundingStatus} | Grounding Score: ${diagnosticLog?.groundingScore}`);
    console.log(`Retrieved Section Coverage:`);
    console.log(`  - Intro/Overview: ${hasIntro}`);
    console.log(`  - Models (HMM/CRF): ${hasModels}`);
    console.log(`  - Sensors/Experiment: ${hasSensors}`);
    console.log(`  - Major Results: ${hasResults}`);
    console.log(`  - Limitations: ${hasLimitations}`);
    console.log(`  - Conclusion: ${hasConclusion}`);
    console.log(`Total Citations Generated: ${context.citations.length}`);

    if (grounded.length >= 6 && diagnosticLog?.groundingStatus === 'GROUNDED' && hasModels && hasSensors && hasResults) {
      console.log('✅ TEST 3 PASSED: Whole-document summary successfully retrieves comprehensive multi-section evidence!');
      passedCount++;
    } else {
      console.error('❌ TEST 3 FAILED');
    }
  }

  // TEST 4: Methodology Question
  console.log('\n--- TEST 4: Methodology Question ---');
  {
    const query = 'Explain the mathematical formulation and feature extraction used for the HMM and CRF models.';
    const intent = rerankService.detectQueryIntent(query);
    const kwHits = await keywordService.search({ query, limit: 12, filter: { documentId } });
    const rrfCandidates = rerankService.reciprocalRankFusion([], kwHits, { topN: 8 });
    const reranked = await rerankService.neuralRerank(query, rrfCandidates, 6, {
      skipNeural: true,
      isSummaryMode: intent.isSummaryOrCrossSection,
    });
    const grounded = rerankService.filterGroundedCandidates(query, reranked, {
      isSummaryMode: intent.isSummaryOrCrossSection,
      intentAnalysis: intent,
    });

    const hasFormulation = grounded.some(c => c.content.includes('P(X,Y)') || c.content.includes('P(Y|X)') || c.content.includes('L-BFGS') || c.content.includes('features'));
    console.log(`Query: "${query}"`);
    console.log(`Grounded Chunks: ${grounded.length}`);
    console.log(`Methodology Formulation Found: ${hasFormulation}`);
    if (grounded.length > 0 && hasFormulation) {
      console.log('✅ TEST 4 PASSED: Methodology question retrieval succeeded');
      passedCount++;
    } else {
      console.error('❌ TEST 4 FAILED');
    }
  }

  // TEST 5: Results Question
  console.log('\n--- TEST 5: Results Question ---');
  {
    const query = 'What were the results for dynamic versus static activities and sensor placement ablation?';
    const intent = rerankService.detectQueryIntent(query);
    const kwHits = await keywordService.search({ query, limit: 12, filter: { documentId } });
    const rrfCandidates = rerankService.reciprocalRankFusion([], kwHits, { topN: 8 });
    const reranked = await rerankService.neuralRerank(query, rrfCandidates, 6, {
      skipNeural: true,
      isSummaryMode: intent.isSummaryOrCrossSection,
    });
    const grounded = rerankService.filterGroundedCandidates(query, reranked, {
      isSummaryMode: intent.isSummaryOrCrossSection,
      intentAnalysis: intent,
    });

    const hasResultsMetrics = grounded.some(c => c.content.includes('96.1%') || c.content.includes('waist') || c.content.includes('ankle'));
    console.log(`Query: "${query}"`);
    console.log(`Grounded Chunks: ${grounded.length}`);
    console.log(`Results Metrics Found: ${hasResultsMetrics}`);
    if (grounded.length > 0 && hasResultsMetrics) {
      console.log('✅ TEST 5 PASSED: Results question retrieval succeeded');
      passedCount++;
    } else {
      console.error('❌ TEST 5 FAILED');
    }
  }

  // TEST 6: Conclusion Question
  console.log('\n--- TEST 6: Conclusion Question ---');
  {
    const query = 'What are the main conclusions and proposed future work in the paper?';
    const intent = rerankService.detectQueryIntent(query);
    const kwHits = await keywordService.search({ query, limit: 12, filter: { documentId } });
    const rrfCandidates = rerankService.reciprocalRankFusion([], kwHits, { topN: 8 });
    const reranked = await rerankService.neuralRerank(query, rrfCandidates, 6, {
      skipNeural: true,
      isSummaryMode: intent.isSummaryOrCrossSection,
    });
    const grounded = rerankService.filterGroundedCandidates(query, reranked, {
      isSummaryMode: intent.isSummaryOrCrossSection,
      intentAnalysis: intent,
    });

    const hasConclusionContent = grounded.some(c => c.content.toLowerCase().includes('conclusion') || c.content.toLowerCase().includes('future work') || c.content.toLowerCase().includes('bilstm'));
    console.log(`Query: "${query}"`);
    console.log(`Grounded Chunks: ${grounded.length}`);
    console.log(`Conclusion Content Found: ${hasConclusionContent}`);
    if (grounded.length > 0 && hasConclusionContent) {
      console.log('✅ TEST 6 PASSED: Conclusion question retrieval succeeded');
      passedCount++;
    } else {
      console.error('❌ TEST 6 FAILED');
    }
  }

  // TEST 7: Question with Insufficient Evidence (Negative Test)
  console.log('\n--- TEST 7: Question with Insufficient Evidence (Strict Non-Hallucination) ---');
  {
    const query = 'Summarize the relativistic quantum gravity warp drive experiments and antimatter propulsion results in this paper.';
    const intent = rerankService.detectQueryIntent(query);
    const kwHits = await keywordService.search({ query, limit: 10, filter: { documentId } });
    const rrfCandidates = rerankService.reciprocalRankFusion([], kwHits, { topN: 6 });
    const reranked = await rerankService.neuralRerank(query, rrfCandidates, 6, {
      skipNeural: true,
      isSummaryMode: intent.isSummaryOrCrossSection,
      facets: intent.facets,
    });

    let diagnosticLog: any = null;
    const grounded = rerankService.filterGroundedCandidates(query, reranked, {
      isSummaryMode: intent.isSummaryOrCrossSection,
      intentAnalysis: intent,
      onDiagnostic: (diag) => {
        diagnosticLog = diag;
      },
    });

    console.log(`Query: "${query}"`);
    console.log(`Grounded Chunks Count: ${grounded.length}`);
    console.log(`Diagnostic Status: ${diagnosticLog?.groundingStatus} | Reason: ${diagnosticLog?.reason}`);

    if (grounded.length === 0 && diagnosticLog?.groundingStatus === 'INSUFFICIENT_EVIDENCE') {
      console.log('✅ TEST 7 PASSED: Non-existent topics correctly rejected with INSUFFICIENT_EVIDENCE');
      passedCount++;
    } else {
      console.error('❌ TEST 7 FAILED: Grounding gate allowed unsupported hallucinations through');
    }
  }

  console.log('\n===========================================================');
  console.log(`  BENCHMARK SUMMARY: ${passedCount} / ${totalCount} TESTS PASSED`);
  console.log('===========================================================');

  if (passedCount === totalCount) {
    console.log('🎉 All 7 retrieval & summary benchmark tests passed successfully!');
    process.exit(0);
  } else {
    console.error('⚠️ Some benchmark tests failed');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Benchmark execution failed:', err);
  process.exit(1);
});
