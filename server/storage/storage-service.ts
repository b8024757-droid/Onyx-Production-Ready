import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface StoredFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  checksum: string;
  storagePath: string;
  createdAt: Date;
}

export class StorageService {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'data', 'uploads');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

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

  public async getFileBuffer(storagePath: string): Promise<Buffer> {
    if (fs.existsSync(storagePath)) {
      return fs.promises.readFile(storagePath);
    }

    // Cross-platform & relocation fallback: extract filename regardless of OS path separator
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
        return fs.promises.readFile(cand);
      }
    }

    throw new Error(`File not found on server: ${filename}. Please re-upload the document.`);
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
