import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { config } from '../config';

export interface StoredFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
  storagePath: string;
  createdAt: Date;
}

export interface UploadSession {
  uploadId: string;
  userId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  chunkSize: number;
  totalChunks: number;
  completedChunks: number[];
  uploadedBytes: number;
  clientSha256?: string;
  collectionId?: string;
  tags?: string[];
  tempDir: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  isAssembled: boolean;
  finalDocumentId?: string;
  finalJobId?: string;
}

export interface UploadInitOptions {
  filename: string;
  sizeBytes: number;
  mimeType?: string;
  chunkSize?: number;
  clientSha256?: string;
  collectionId?: string;
  tags?: string[];
  userId: string;
}

export class StorageService {
  private baseDir: string;
  private tempBaseDir: string;
  private sessions = new Map<string, UploadSession>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'data', 'uploads');
    this.tempBaseDir = path.join(this.baseDir, 'temp_chunks');

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempBaseDir)) {
      fs.mkdirSync(this.tempBaseDir, { recursive: true });
    }

    // Start background cleanup timer for abandoned/expired uploads (unref'd to not hold Node process)
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions().catch(err => {
        console.warn('[StorageService] Error during session cleanup:', err);
      });
    }, 15 * 60 * 1000); // Every 15 minutes
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  // =========================================================================
  // RESUMABLE CHUNKED UPLOAD SESSIONS
  // =========================================================================

  /**
   * Initializes a new chunked upload session for large files
   */
  public async initUploadSession(options: UploadInitOptions): Promise<UploadSession> {
    const maxAllowed = config.upload.maxFileSizeBytes;
    if (options.sizeBytes <= 0) {
      throw new Error('Invalid file size. File size must be greater than 0.');
    }
    if (options.sizeBytes > maxAllowed) {
      throw new Error(`File exceeds the maximum allowed size of ${config.upload.maxFileSizeMb} MB.`);
    }

    const chunkSize = options.chunkSize || config.upload.chunkSizeBytes;
    if (chunkSize <= 0 || chunkSize > 50 * 1024 * 1024) {
      throw new Error('Invalid chunk size. Chunk size must be between 1 MB and 50 MB.');
    }

    const totalChunks = Math.ceil(options.sizeBytes / chunkSize);
    const uploadId = `upload_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
    const tempDir = path.join(this.tempBaseDir, uploadId);

    // Create session temp directory on disk
    await fs.promises.mkdir(tempDir, { recursive: true });

    const now = new Date();
    const ttlMs = config.upload.sessionTtlMinutes * 60 * 1000;
    const expiresAt = new Date(now.getTime() + ttlMs);

    const session: UploadSession = {
      uploadId,
      userId: options.userId,
      filename: options.filename,
      mimeType: options.mimeType || 'application/octet-stream',
      sizeBytes: options.sizeBytes,
      chunkSize,
      totalChunks,
      completedChunks: [],
      uploadedBytes: 0,
      clientSha256: options.clientSha256?.toLowerCase(),
      collectionId: options.collectionId,
      tags: options.tags,
      tempDir,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      isAssembled: false,
    };

    this.sessions.set(uploadId, session);
    return session;
  }

  /**
   * Retrieves an active upload session with strict tenant isolation check
   */
  public getUploadSession(uploadId: string, userId: string): UploadSession | null {
    const session = this.sessions.get(uploadId);
    if (!session) return null;

    // Tenant check
    if (session.userId !== userId) {
      return null;
    }

    // Expiry check
    if (Date.now() > session.expiresAt.getTime()) {
      this.abortUpload(uploadId, userId).catch(() => {});
      return null;
    }

    return session;
  }

  /**
   * Writes an incoming chunk directly to temporary disk storage using streaming
   */
  public async saveChunkStream(
    uploadId: string,
    userId: string,
    chunkIndex: number,
    stream: NodeJS.ReadableStream,
    expectedChunkSha256?: string
  ): Promise<{ chunkIndex: number; size: number; sha256: string; isComplete: boolean }> {
    const session = this.getUploadSession(uploadId, userId);
    if (!session) {
      throw new Error('Upload session not found or expired.');
    }
    if (session.isAssembled) {
      throw new Error('Upload session has already been completed.');
    }
    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new Error(`Invalid chunk index ${chunkIndex}. Expected 0 to ${session.totalChunks - 1}.`);
    }

    const chunkPath = path.join(session.tempDir, `chunk_${chunkIndex}`);
    const hash = crypto.createHash('sha256');
    let bytesWritten = 0;

    const writeStream = fs.createWriteStream(chunkPath);

    // Stream directly to disk while updating SHA-256 hash in flight (Zero RAM)
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        bytesWritten += chunk.length;
        hash.update(chunk);
      });

      stream.pipe(writeStream);

      writeStream.on('finish', () => resolve());
      writeStream.on('error', (err) => reject(err));
      stream.on('error', (err) => reject(err));
    });

    const computedChunkSha256 = hash.digest('hex');

    // Optional client chunk checksum validation
    if (expectedChunkSha256 && expectedChunkSha256.toLowerCase() !== computedChunkSha256) {
      try { await fs.promises.unlink(chunkPath); } catch {}
      throw new Error('Chunk integrity verification failed (checksum mismatch).');
    }

    // Update session state idempotently
    if (!session.completedChunks.includes(chunkIndex)) {
      session.completedChunks.push(chunkIndex);
      session.completedChunks.sort((a, b) => a - b);
      session.uploadedBytes += bytesWritten;
    }
    session.updatedAt = new Date();

    const isComplete = session.completedChunks.length === session.totalChunks;
    return {
      chunkIndex,
      size: bytesWritten,
      sha256: computedChunkSha256,
      isComplete,
    };
  }

  /**
   * Writes a chunk from a Buffer (convenience wrapper over stream)
   */
  public async saveChunkBuffer(
    uploadId: string,
    userId: string,
    chunkIndex: number,
    buffer: Buffer,
    expectedChunkSha256?: string
  ): Promise<{ chunkIndex: number; size: number; sha256: string; isComplete: boolean }> {
    const readable = Readable.from(buffer);
    return this.saveChunkStream(uploadId, userId, chunkIndex, readable, expectedChunkSha256);
  }

  /**
   * Assembles all uploaded chunks into the final stored file using zero-RAM filesystem streaming
   */
  public async assembleUpload(
    uploadId: string,
    userId: string
  ): Promise<{ storedFile: StoredFile; session: UploadSession }> {
    const session = this.getUploadSession(uploadId, userId);
    if (!session) {
      throw new Error('Upload session not found or expired.');
    }
    if (session.isAssembled && session.finalDocumentId) {
      throw new Error('Upload session already assembled.');
    }

    // Verify all chunks are present
    if (session.completedChunks.length !== session.totalChunks) {
      throw new Error(
        `Cannot assemble upload. Only ${session.completedChunks.length} of ${session.totalChunks} chunks received.`
      );
    }

    for (let i = 0; i < session.totalChunks; i++) {
      const chunkPath = path.join(session.tempDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        throw new Error(`Missing chunk ${i} on server storage. Please re-upload chunk ${i}.`);
      }
    }

    // Prepare destination stored file in /data/uploads
    const fileId = `file_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(session.filename) || '';
    const safeStorageName = `${fileId}${ext}`;
    const finalStoragePath = path.join(this.baseDir, safeStorageName);

    const finalHash = crypto.createHash('sha256');
    let totalAssembledBytes = 0;

    const outStream = fs.createWriteStream(finalStoragePath);

    try {
      // Sequentially stream each chunk into the output stream while hashing (Zero RAM)
      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = path.join(session.tempDir, `chunk_${i}`);
        await new Promise<void>((resolve, reject) => {
          const chunkReadStream = fs.createReadStream(chunkPath);
          chunkReadStream.on('data', (chunk: Buffer) => {
            totalAssembledBytes += chunk.length;
            finalHash.update(chunk);
          });
          chunkReadStream.pipe(outStream, { end: false });
          chunkReadStream.on('end', () => resolve());
          chunkReadStream.on('error', (err) => reject(err));
        });
      }

      // Close output stream
      await new Promise<void>((resolve, reject) => {
        outStream.end(() => resolve());
        outStream.on('error', (err) => reject(err));
      });

      const finalSha256 = finalHash.digest('hex');

      // Verify client final SHA-256 if provided
      if (session.clientSha256 && session.clientSha256 !== finalSha256) {
        throw new Error('Assembled file SHA-256 checksum does not match expected client hash.');
      }

      // Verify total file size
      if (totalAssembledBytes !== session.sizeBytes) {
        throw new Error(
          `Assembled file size (${totalAssembledBytes} bytes) does not match expected size (${session.sizeBytes} bytes).`
        );
      }

      // Clean up temporary chunk folder
      try {
        await fs.promises.rm(session.tempDir, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn('[StorageService] Could not clean temp chunk dir:', rmErr);
      }

      session.isAssembled = true;
      session.uploadedBytes = totalAssembledBytes;
      session.updatedAt = new Date();

      const storedFile: StoredFile = {
        id: fileId,
        originalName: session.filename,
        mimeType: session.mimeType,
        size: totalAssembledBytes,
        checksum: finalSha256,
        storagePath: finalStoragePath,
        createdAt: new Date(),
      };

      return { storedFile, session };
    } catch (err) {
      // If assembly fails, remove incomplete final output file
      try {
        if (fs.existsSync(finalStoragePath)) {
          await fs.promises.unlink(finalStoragePath);
        }
      } catch {}
      throw err;
    }
  }

  /**
   * Aborts an upload session and deletes temporary chunks
   */
  public async abortUpload(uploadId: string, userId: string): Promise<boolean> {
    const session = this.sessions.get(uploadId);
    if (!session) return true;

    if (session.userId !== userId) {
      throw new Error('Access denied: Unauthorized to abort this upload session.');
    }

    try {
      if (fs.existsSync(session.tempDir)) {
        await fs.promises.rm(session.tempDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('[StorageService] Error cleaning aborted temp dir:', err);
    }

    this.sessions.delete(uploadId);
    return true;
  }

  /**
   * Background task: Purges expired upload sessions and orphaned temp directories
   */
  public async cleanupExpiredSessions(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [uploadId, session] of this.sessions.entries()) {
      if (now > session.expiresAt.getTime() || session.isAssembled) {
        try {
          if (fs.existsSync(session.tempDir)) {
            await fs.promises.rm(session.tempDir, { recursive: true, force: true });
          }
        } catch {}
        this.sessions.delete(uploadId);
        cleaned++;
      }
    }

    // Also scan tempBaseDir for orphaned directories older than 2 hours
    try {
      if (fs.existsSync(this.tempBaseDir)) {
        const entries = await fs.promises.readdir(this.tempBaseDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const dirPath = path.join(this.tempBaseDir, entry.name);
            const stat = await fs.promises.stat(dirPath);
            const ageMs = now - stat.mtimeMs;
            if (ageMs > 2 * 60 * 60 * 1000) { // 2 hours
              await fs.promises.rm(dirPath, { recursive: true, force: true });
              cleaned++;
            }
          }
        }
      }
    } catch {}

    return cleaned;
  }

  // =========================================================================
  // EXISTING SINGLE-FILE UTILITIES (Backward Compatible)
  // =========================================================================

  public async saveFile(
    filename: string,
    buffer: Buffer,
    mimeType: string
  ): Promise<StoredFile> {
    const id = `file_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const ext = path.extname(filename) || '';
    const safeStorageName = `${id}${ext}`;
    const storagePath = path.join(this.baseDir, safeStorageName);

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');

    await fs.promises.writeFile(storagePath, buffer);

    return {
      id,
      originalName: filename,
      mimeType,
      size: buffer.length,
      checksum,
      storagePath,
      createdAt: new Date(),
    };
  }

  public async saveString(
    filename: string,
    content: string,
    mimeType = 'text/plain'
  ): Promise<StoredFile> {
    const buffer = Buffer.from(content, 'utf-8');
    return this.saveFile(filename, buffer, mimeType);
  }

  public resolveStoragePath(storagePath: string): string {
    if (fs.existsSync(storagePath)) {
      return storagePath;
    }

    const normalizedPath = storagePath.replace(/\\/g, '/');
    const filename = path.basename(normalizedPath);

    const candidates = [
      path.join(this.baseDir, filename),
      path.join(process.cwd(), 'data', 'uploads', filename),
      path.join(process.cwd(), 'uploads', filename),
      path.join('/tmp', filename),
    ];

    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        return cand;
      }
    }

    throw new Error(`File not found on server: ${filename}. Please re-upload the document.`);
  }

  public getFileStream(storagePath: string): fs.ReadStream {
    const resolvedPath = this.resolveStoragePath(storagePath);
    return fs.createReadStream(resolvedPath);
  }

  public getFileSize(storagePath: string): number {
    const resolvedPath = this.resolveStoragePath(storagePath);
    const stats = fs.statSync(resolvedPath);
    return stats.size;
  }

  public async computeFileChecksumStream(storagePath: string): Promise<string> {
    const resolvedPath = this.resolveStoragePath(storagePath);
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(resolvedPath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  }

  public async getFileBuffer(storagePath: string): Promise<Buffer> {
    const resolvedPath = this.resolveStoragePath(storagePath);
    return fs.promises.readFile(resolvedPath);
  }

  public async deleteFile(storagePath: string): Promise<boolean> {
    try {
      if (fs.existsSync(storagePath)) {
        await fs.promises.unlink(storagePath);
        return true;
      }
      const normalizedPath = storagePath.replace(/\\/g, '/');
      const filename = path.basename(normalizedPath);
      const candidates = [
        path.join(this.baseDir, filename),
        path.join(process.cwd(), 'data', 'uploads', filename),
        path.join(process.cwd(), 'uploads', filename),
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand)) {
          await fs.promises.unlink(cand);
          return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const storageService = new StorageService();
