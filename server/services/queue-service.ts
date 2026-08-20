import { Queue, Worker, Job } from 'bullmq';
import IORedis, { type RedisOptions } from 'ioredis';
import { dbService } from '../db/database';
import { ProcessingJob, DocumentType } from '../../src/types';

export interface IngestionJobData {
  jobId: string;
  userId?: string;
  documentId: string;
  filename: string;
  fileType?: DocumentType;
  fileSizeBytes?: number;
  storagePath?: string;
  mimeType?: string;
  collectionId?: string;
  tags?: string[];
  url?: string;
  content?: string;
  chunkSize?: number;
  chunkOverlap?: number;
}

export type JobProcessorFn = (data: IngestionJobData, updateProgress: (progress: number, stage: string) => Promise<void>) => Promise<any>;

function parseRedisConfig(raw?: string): { url: string; isTls: boolean; options: RedisOptions } | null {
  if (!raw) return null;
  let str = raw.trim();
  // Strip leading variable assignment prefix if user/env passed `REDIS_URL="rediss://..."`
  str = str.replace(/^REDIS_URL\s*=\s*/i, '').replace(/^["']|["']$/g, '').trim();
  if (!str || str === '""' || str === "''") return null;

  // Extract from CLI string if provided like 'redis-cli -u ...'
  if (str.includes('-u ')) {
    str = str.split('-u ')[1].trim();
  }

  // Normalize missing or malformed protocols (e.g. //default:... or default:password@host:port)
  let isTls = false;
  if (str.startsWith('rediss://')) {
    isTls = true;
  } else if (str.startsWith('redis://')) {
    if (str.includes('upstash.io')) {
      str = 'rediss://' + str.slice('redis://'.length);
      isTls = true;
    }
  } else if (str.startsWith('//')) {
    if (str.includes('upstash.io')) {
      str = 'rediss:' + str;
      isTls = true;
    } else {
      str = 'redis:' + str;
    }
  } else {
    if (str.includes('upstash.io')) {
      str = 'rediss://' + str;
      isTls = true;
    } else {
      str = 'redis://' + str;
    }
  }

  const options: RedisOptions = {
    maxRetriesPerRequest: null,
    connectTimeout: 10000,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, 3000),
    tls: isTls ? { rejectUnauthorized: false } : undefined,
  };

  return { url: str, isTls, options };
}

export class QueueService {
  private redisConnection: IORedis | null = null;
  private workerConnection: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private isRedisConnected = false;
  private connectionError: string | null = null;
  private processor: JobProcessorFn | null = null;
  private redisConfig: { url: string; isTls: boolean; options: RedisOptions } | null = null;

  constructor() {
    this.redisConfig = parseRedisConfig(process.env.REDIS_URL);
    this.initRedis();
  }

  private initRedis(): void {
    if (!this.redisConfig) {
      this.isRedisConnected = false;
      this.connectionError = 'No Redis URL configured in environment.';
      console.log('[Queue] mode = DEGRADED_IN_PROCESS, redis = DISCONNECTED (No Redis configured)');
      return;
    }

    try {
      this.redisConnection = new IORedis(this.redisConfig.url, this.redisConfig.options);

      this.redisConnection.on('connect', () => {
        console.log('[BullMQ/IORedis] Connected to Redis socket.');
      });

      this.redisConnection.on('ready', () => {
        this.isRedisConnected = true;
        this.connectionError = null;
        console.log('[Queue] mode = BULLMQ, redis = CONNECTED');
        if (this.processor && !this.queue && this.redisConfig) {
          this.initBullMQQueue(this.redisConfig.url, this.redisConfig.options);
        }
      });

      this.redisConnection.on('error', (err: Error) => {
        this.isRedisConnected = false;
        this.connectionError = err.message;
        console.warn(`[Queue] mode = DEGRADED_IN_PROCESS, redis = DISCONNECTED (Error: ${err.message})`);
      });
    } catch (err: any) {
      this.isRedisConnected = false;
      this.connectionError = err.message;
      console.warn(`[Queue] mode = DEGRADED_IN_PROCESS, redis = DISCONNECTED (Error: ${err.message})`);
    }
  }

  private initBullMQQueue(redisUrl: string, connectionOptions: RedisOptions): void {
    if (!this.processor) return;
    try {
      this.queue = new Queue('document-ingestion-queue', {
        connection: this.redisConnection!,
      });

      this.workerConnection = new IORedis(redisUrl, connectionOptions);
      this.workerConnection.on('error', (err: Error) => {
        console.warn(`[BullMQ Worker Redis] Connection note: ${err.message}`);
      });

      this.worker = new Worker(
        'document-ingestion-queue',
        async (job: Job<IngestionJobData>) => {
          return this.processor!(job.data, async (progress, stage) => {
            await job.updateProgress(progress);
            const jobRec = await dbService.getJob(job.data.jobId);
            if (jobRec) {
              jobRec.progress = progress;
              jobRec.stepMessage = stage;
              if (progress >= 100) {
                jobRec.status = 'READY';
                jobRec.completedAt = new Date().toISOString();
              } else if (progress >= 90) {
                jobRec.status = 'INDEXING';
              } else if (progress >= 75) {
                jobRec.status = 'EMBEDDING';
              } else if (progress >= 50) {
                jobRec.status = 'CHUNKING';
              } else if (progress >= 25) {
                jobRec.status = 'PARSING';
              }
              await dbService.saveJob(jobRec);
            }

            const doc = await dbService.getDocumentById(job.data.documentId, job.data.userId);
            if (doc && doc.status !== 'READY') {
              doc.progress = progress;
              doc.statusMessage = stage;
              if (progress >= 100) {
                doc.status = 'READY';
              } else if (progress >= 90) {
                doc.status = 'INDEXING';
              } else if (progress >= 75) {
                doc.status = 'EMBEDDING';
              } else if (progress >= 50) {
                doc.status = 'CHUNKING';
              } else if (progress >= 25) {
                doc.status = 'PARSING';
              }
              doc.updatedAt = new Date().toISOString();
              await dbService.saveDocument(doc);
            }
          });
        },
        { connection: this.workerConnection, concurrency: 3 }
      );

      this.worker.on('completed', async (job: Job<IngestionJobData>) => {
        const jobRec = await dbService.getJob(job.data.jobId);
        if (jobRec) {
          jobRec.status = 'READY';
          jobRec.progress = 100;
          jobRec.completedAt = new Date().toISOString();
          await dbService.saveJob(jobRec);
        }
      });

      this.worker.on('failed', async (job: Job<IngestionJobData> | undefined, err: Error) => {
        if (!job) return;
        const jobRec = await dbService.getJob(job.data.jobId);
        if (jobRec) {
          jobRec.status = 'FAILED';
          jobRec.error = err.message || 'Worker processing failed';
          jobRec.completedAt = new Date().toISOString();
          await dbService.saveJob(jobRec);
        }
        const doc = await dbService.getDocumentById(job.data.documentId);
        if (doc) {
          doc.status = 'FAILED';
          doc.statusMessage = `Ingestion failed: ${err.message || 'Worker failure'}`;
          doc.updatedAt = new Date().toISOString();
          await dbService.saveDocument(doc);
        }
      });

      this.worker.on('error', (err) => {
        console.warn(`[BullMQ Worker] Worker event: ${err.message}`);
      });

      console.log('[BullMQ] Queue and Worker successfully active with Redis backend.');
    } catch (err: any) {
      console.warn(`[BullMQ] Setup failed: ${err.message}. Reverting to degraded in-process worker.`);
    }
  }

  public registerProcessor(processor: JobProcessorFn): void {
    this.processor = processor;
    if (this.isRedisConnected && this.redisConnection && !this.queue && this.redisConfig) {
      this.initBullMQQueue(this.redisConfig.url, this.redisConfig.options);
    }
  }

  public async addIngestionJob(data: IngestionJobData): Promise<void> {
    const jobRecord: ProcessingJob = {
      id: data.jobId,
      documentId: data.documentId,
      fileName: data.filename || data.url || 'Document',
      fileType: data.fileType || 'TXT',
      fileSizeBytes: data.fileSizeBytes || 0,
      status: 'UPLOADING',
      progress: 10,
      stepMessage: 'File uploaded and queued for processing',
      startedAt: new Date().toISOString(),
    };

    await dbService.saveJob(jobRecord);

    if (this.isRedisConnected && this.queue) {
      try {
        await this.queue.add('ingest-document', data, {
          jobId: data.jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
        });

        // Watchdog: fallback to in-process execution if worker does not start within 3.5s
        setTimeout(async () => {
          const currentJob = await dbService.getJob(data.jobId);
          if (currentJob && currentJob.status === 'UPLOADING') {
            console.warn(`[BullMQ Watchdog] Job ${data.jobId} not picked up by worker within 3.5s. Executing via in-process pipeline.`);
            this.executeAsyncJob(data);
          }
        }, 3500);

        return;
      } catch (err: any) {
        console.warn(`[BullMQ] Failed to enqueue to Redis: ${err.message}. Running via degraded in-process queue.`);
      }
    }

    // Degraded in-process queue execution
    this.executeAsyncJob(data);
  }

  private async executeAsyncJob(data: IngestionJobData): Promise<void> {
    if (!this.processor) {
      console.error('[QueueService] No processor registered!');
      return;
    }

    // Run in background without blocking caller
    setImmediate(async () => {
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          attempts++;
          await this.processor!(data, async (progress: number, stage: string) => {
            const job = await dbService.getJob(data.jobId);
            if (job) {
              job.progress = progress;
              job.stepMessage = stage;
              if (progress >= 100) {
                job.status = 'READY';
                job.completedAt = new Date().toISOString();
              } else if (progress >= 90) {
                job.status = 'INDEXING';
              } else if (progress >= 75) {
                job.status = 'EMBEDDING';
              } else if (progress >= 50) {
                job.status = 'CHUNKING';
              } else if (progress >= 25) {
                job.status = 'PARSING';
              }
              await dbService.saveJob(job);
            }
          });

          // Job completed successfully
          return;
        } catch (err: any) {
          const errMsg = err.message || String(err);
          console.error(`[QueueService] Job ${data.jobId} attempt ${attempts} failed:`, errMsg);

          const isUnrecoverable =
            errMsg.includes('File not found') ||
            errMsg.includes('Invalid PDF') ||
            errMsg.includes('Unsupported document format') ||
            errMsg.includes('Failed to parse');

          if (isUnrecoverable || attempts >= maxAttempts) {
            const job = await dbService.getJob(data.jobId);
            if (job) {
              job.status = 'FAILED';
              job.error = errMsg;
              job.completedAt = new Date().toISOString();
              await dbService.saveJob(job);
            }

            const doc = await dbService.getDocumentById(data.documentId);
            if (doc) {
              doc.status = 'FAILED';
              doc.statusMessage = errMsg;
              doc.updatedAt = new Date().toISOString();
              await dbService.saveDocument(doc);
            }
            return;
          }
          // Exponential backoff delay for transient errors
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempts - 1)));
        }
      }
    });
  }

  public getHealth(): {
    mode: 'BULLMQ' | 'DEGRADED_IN_PROCESS';
    redisStatus: 'CONNECTED' | 'DISCONNECTED';
    isRedisConnected: boolean;
    queueName: string;
    error: string | null;
  } {
    const isBullMQ = this.isRedisConnected && !!this.queue;
    return {
      mode: isBullMQ ? 'BULLMQ' : 'DEGRADED_IN_PROCESS',
      redisStatus: this.isRedisConnected ? 'CONNECTED' : 'DISCONNECTED',
      isRedisConnected: this.isRedisConnected,
      queueName: 'document-ingestion-queue',
      error: this.connectionError,
    };
  }
}

export const queueService = new QueueService();
