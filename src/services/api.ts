/**
 * Second Brain — Client API Service
 * Typed HTTP & Server-Sent Events client for the backend API with
 * JWT Authorization token injection, User Authentication, and Infrastructure Setup flows.
 */

import {
  Document,
  Collection,
  Conversation,
  Message,
  Citation,
  SearchResult,
  SecondBrainStats,
  ProcessingJob,
  QueryMetrics,
  AppNotification,
  User,
  SetupStatus,
} from '../types';

let currentAuthToken: string | null = typeof window !== 'undefined' ? localStorage.getItem('sb_auth_token') : null;

export const setAuthToken = (token: string | null) => {
  currentAuthToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('sb_auth_token', token);
    } else {
      localStorage.removeItem('sb_auth_token');
    }
  }
};

export const getAuthToken = (): string | null => {
  if (!currentAuthToken && typeof window !== 'undefined') {
    currentAuthToken = localStorage.getItem('sb_auth_token');
  }
  return currentAuthToken;
};

const getAuthHeaders = (additionalHeaders: Record<string, string> = {}): Record<string, string> => {
  const headers: Record<string, string> = { ...additionalHeaders };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

export const api = {
  // Auth Operations
  async login(payload: { email: string; password: string }): Promise<{ user: User; token: string; setupStatus: SetupStatus }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setAuthToken(data.token);
    return data;
  },

  async signup(payload: {
    name: string;
    email: string;
    password: string;
    confirmPassword?: string;
  }): Promise<{ user: User; token: string; setupStatus: SetupStatus }> {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Signup failed');
    setAuthToken(data.token);
    return data;
  },

  async getCurrentUser(): Promise<{ user: User; setupStatus: SetupStatus }> {
    const res = await fetch('/api/auth/me', {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to authenticate user');
    return data;
  },

  async forgotPassword(payload: { email: string }): Promise<{ success: boolean; message: string; resetToken?: string }> {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Forgot password failed');
    return data;
  },

  async resetPassword(payload: {
    token: string;
    newPassword: string;
    confirmPassword?: string;
  }): Promise<{ success: boolean; message: string }> {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Reset password failed');
    return data;
  },

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
    } catch {}
    setAuthToken(null);
  },

  // Setup & Infrastructure Operations
  async getSetupStatus(): Promise<{ setupStatus: SetupStatus }> {
    const res = await fetch('/api/setup/status', {
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load setup status');
    return data;
  },

  async setupGemini(payload: { apiKey?: string; skip?: boolean }): Promise<{ success: boolean; message: string; setupStatus: SetupStatus }> {
    const res = await fetch('/api/setup/gemini', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gemini setup failed');
    return data;
  },

  async setupQdrant(payload: { url?: string; apiKey?: string; skip?: boolean }): Promise<{ success: boolean; message: string; setupStatus: SetupStatus }> {
    const res = await fetch('/api/setup/qdrant', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Qdrant setup failed');
    return data;
  },

  async setupPostgres(payload: { connectionUrl?: string; skip?: boolean }): Promise<{ success: boolean; message: string; setupStatus: SetupStatus }> {
    const res = await fetch('/api/setup/postgres', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'PostgreSQL setup failed');
    return data;
  },

  async completeSetup(): Promise<{ success: boolean; message: string; setupStatus: SetupStatus }> {
    const res = await fetch('/api/setup/complete', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Complete setup failed');
    return data;
  },

  async testConnection(target: 'gemini' | 'qdrant' | 'postgres'): Promise<{ connected: boolean; latencyMs: number; message: string }> {
    const res = await fetch('/api/setup/test-connection', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ target }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Test connection failed');
    return data;
  },

  // Stats & System
  async getStats(): Promise<{ stats: SecondBrainStats; systemStatus: Record<string, string> }> {
    const res = await fetch('/api/stats', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch stats');
    return res.json();
  },

  async getMetrics(): Promise<{ metrics: Partial<QueryMetrics> }> {
    const res = await fetch('/api/metrics', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch metrics');
    return res.json();
  },

  // Documents
  async getDocuments(category?: string, search?: string): Promise<{ documents: Document[] }> {
    const params = new URLSearchParams();
    if (category && category !== 'All') params.append('category', category);
    if (search) params.append('search', search);

    const res = await fetch(`/api/documents?${params.toString()}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch documents');
    return res.json();
  },

  async getDocument(id: string): Promise<{ document: Document; chunks: any[] }> {
    const res = await fetch(`/api/documents/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch document');
    return res.json();
  },

  async uploadDocument(payload: {
    name: string;
    content: string;
    type: string;
    sizeBytes: number;
    sourceUrl?: string;
    collectionId?: string;
    tags?: string[];
  }): Promise<{ message: string; jobId: string; documentId: string }> {
    const res = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to upload document');
    return res.json();
  },

  // Resumable Chunked Streaming Upload Methods
  async initChunkedUpload(
    payload: {
      filename: string;
      sizeBytes: number;
      mimeType?: string;
      chunkSize?: number;
      clientSha256?: string;
      collectionId?: string;
      tags?: string[];
    },
    signal?: AbortSignal
  ): Promise<{
    uploadId: string;
    filename: string;
    sizeBytes: number;
    chunkSize: number;
    totalChunks: number;
    maxFileSizeBytes: number;
    expiresAt: string;
  }> {
    const res = await fetch('/api/documents/upload/init', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to init upload' }));
      throw new Error(err.error || 'Failed to initialize chunked upload');
    }
    return res.json();
  },

  async uploadChunk(
    uploadId: string,
    chunkIndex: number,
    chunkBlob: Blob,
    sha256?: string,
    signal?: AbortSignal
  ): Promise<{
    uploadId: string;
    chunkIndex: number;
    size: number;
    sha256: string;
    uploadedBytes: number;
    totalChunks: number;
    completedChunksCount: number;
    isComplete: boolean;
  }> {
    const headers: Record<string, string> = {
      'x-upload-id': uploadId,
      'x-chunk-index': String(chunkIndex),
      'Content-Type': 'application/octet-stream',
    };
    if (sha256) headers['x-chunk-sha256'] = sha256;

    const res = await fetch(`/api/documents/upload/${uploadId}/chunk`, {
      method: 'POST',
      headers: getAuthHeaders(headers),
      body: chunkBlob,
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Chunk upload failed' }));
      throw new Error(err.error || `Failed to upload chunk ${chunkIndex}`);
    }
    return res.json();
  },

  async getUploadStatus(uploadId: string, signal?: AbortSignal): Promise<{
    uploadId: string;
    filename: string;
    sizeBytes: number;
    chunkSize: number;
    totalChunks: number;
    uploadedBytes: number;
    completedChunks: number[];
    isComplete: boolean;
    expiresAt: string;
    status: string;
  }> {
    const res = await fetch(`/api/documents/upload/${uploadId}/status`, {
      headers: getAuthHeaders(),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Status fetch failed' }));
      throw new Error(err.error || 'Failed to query upload session status');
    }
    return res.json();
  },

  async completeChunkedUpload(uploadId: string, signal?: AbortSignal): Promise<{
    message: string;
    uploadId: string;
    documentId: string;
    jobId: string;
    contentHash: string;
    sizeBytes: number;
  }> {
    const res = await fetch(`/api/documents/upload/${uploadId}/complete`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Complete upload failed' }));
      throw new Error(err.error || 'Failed to complete upload session');
    }
    return res.json();
  },

  async abortChunkedUpload(uploadId: string): Promise<{ success: boolean; message: string }> {
    const res = await fetch(`/api/documents/upload/${uploadId}/abort`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Abort failed' }));
      throw new Error(err.error || 'Failed to abort upload session');
    }
    return res.json();
  },

  /**
   * High-level streaming chunked uploader using native browser File/Blob slicing.
   * Zero entire-file RAM overhead — only 5 MB slice loaded in memory at any time.
   */
  async uploadFileChunked(
    file: File | Blob,
    filename: string,
    options?: {
      chunkSize?: number;
      collectionId?: string;
      tags?: string[];
      signal?: AbortSignal;
      maxRetriesPerChunk?: number;
      onProgress?: (progress: {
        uploadId: string;
        chunkIndex: number;
        totalChunks: number;
        uploadedBytes: number;
        totalBytes: number;
        percent: number;
        stage: 'INIT' | 'UPLOADING' | 'ASSEMBLING';
      }) => void;
    }
  ): Promise<{
    message: string;
    uploadId: string;
    documentId: string;
    jobId: string;
    contentHash: string;
    sizeBytes: number;
  }> {
    const sizeBytes = file.size;
    const chunkSize = options?.chunkSize || 5 * 1024 * 1024; // 5 MB chunk size
    const totalChunks = Math.max(1, Math.ceil(sizeBytes / chunkSize));
    const mimeType = (file as File).type || 'application/octet-stream';

    if (options?.signal?.aborted) {
      throw new Error('Upload aborted');
    }

    options?.onProgress?.({
      uploadId: '',
      chunkIndex: 0,
      totalChunks,
      uploadedBytes: 0,
      totalBytes: sizeBytes,
      percent: 0,
      stage: 'INIT',
    });

    const initRes = await this.initChunkedUpload(
      {
        filename,
        sizeBytes,
        mimeType,
        chunkSize,
        collectionId: options?.collectionId,
        tags: options?.tags,
      },
      options?.signal
    );

    const uploadId = initRes.uploadId;
    let uploadedBytes = 0;

    try {
      for (let i = 0; i < totalChunks; i++) {
        if (options?.signal?.aborted) {
          await this.abortChunkedUpload(uploadId).catch(() => {});
          throw new Error('Upload aborted by user');
        }

        const start = i * chunkSize;
        const end = Math.min(sizeBytes, start + chunkSize);
        // Native Blob.slice — Zero RAM footprint (references underlying disk/file descriptor)
        const chunkBlob = file.slice(start, end);

        // Compute client SHA-256 per 5MB chunk in-flight via Web Crypto
        let chunkSha256: string | undefined;
        try {
          if (typeof crypto !== 'undefined' && crypto.subtle) {
            const chunkBuf = await chunkBlob.arrayBuffer();
            const digest = await crypto.subtle.digest('SHA-256', chunkBuf);
            chunkSha256 = Array.from(new Uint8Array(digest))
              .map(b => b.toString(16).padStart(2, '0'))
              .join('');
          }
        } catch {
          // Non-blocking if subtle crypto unavailable
        }

        // Retry loop for individual chunk failure resilience
        const maxRetries = options?.maxRetriesPerChunk ?? 3;
        let attempt = 0;
        let success = false;
        let lastError: any = null;

        while (attempt <= maxRetries && !success) {
          if (options?.signal?.aborted) {
            await this.abortChunkedUpload(uploadId).catch(() => {});
            throw new Error('Upload aborted by user');
          }

          try {
            await this.uploadChunk(uploadId, i, chunkBlob, chunkSha256, options?.signal);
            success = true;
          } catch (err: any) {
            attempt++;
            lastError = err;
            if (attempt <= maxRetries && !options?.signal?.aborted) {
              const backoffMs = Math.min(500 * Math.pow(2, attempt - 1), 3000);
              await new Promise(r => setTimeout(r, backoffMs));
            }
          }
        }

        if (!success) {
          await this.abortChunkedUpload(uploadId).catch(() => {});
          throw lastError || new Error(`Failed to upload chunk ${i + 1} after ${maxRetries} retries`);
        }

        uploadedBytes = end;
        const percent = Math.min(100, Math.round((uploadedBytes / sizeBytes) * 100));

        options?.onProgress?.({
          uploadId,
          chunkIndex: i + 1,
          totalChunks,
          uploadedBytes,
          totalBytes: sizeBytes,
          percent,
          stage: 'UPLOADING',
        });
      }

      options?.onProgress?.({
        uploadId,
        chunkIndex: totalChunks,
        totalChunks,
        uploadedBytes: sizeBytes,
        totalBytes: sizeBytes,
        percent: 100,
        stage: 'ASSEMBLING',
      });

      const completeRes = await this.completeChunkedUpload(uploadId, options?.signal);
      return completeRes;
    } catch (err: any) {
      if (uploadId) {
        await this.abortChunkedUpload(uploadId).catch(() => {});
      }
      throw err;
    }
  },

  async deleteDocument(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/documents/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete document');
    return res.json();
  },

  async retryDocument(id: string): Promise<{ message: string; jobId: string; documentId: string }> {
    const res = await fetch(`/api/documents/${id}/retry`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Retry failed' }));
      throw new Error(err.error || 'Failed to retry document indexing');
    }
    return res.json();
  },

  async getDocumentStatus(id: string): Promise<{
    id: string;
    title?: string;
    type?: DocumentType;
    status: Document['status'];
    progress: number;
    statusMessage?: string;
    chunkCount?: number;
    pageCount?: number;
    slideCount?: number;
    sectionCount?: number;
    sizeBytes?: number;
    metrics?: Document['metrics'];
    updatedAt: string;
  }> {
    const res = await fetch(`/api/documents/${id}/status`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch document status');
    return res.json();
  },

  // Collections
  async getCollections(): Promise<{ collections: Collection[] }> {
    const res = await fetch('/api/collections', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch collections');
    return res.json();
  },

  async createCollection(payload: {
    name: string;
    description?: string;
    tags?: string[];
  }): Promise<{ collection: Collection }> {
    const res = await fetch('/api/collections', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to create collection');
    return res.json();
  },

  async deleteCollection(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/collections/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to delete collection');
    return res.json();
  },

  // Search
  async search(payload: {
    query: string;
    collectionId?: string;
    documentId?: string;
  }): Promise<{ results: SearchResult[]; citations: Citation[]; metrics: Partial<QueryMetrics> }> {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to execute search');
    return res.json();
  },

  // Conversations & Chat
  async getConversations(): Promise<{ conversations: Conversation[] }> {
    const res = await fetch('/api/chat/conversations', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch conversations');
    return res.json();
  },

  async createConversation(title?: string, collectionScopeId?: string): Promise<{ conversation: Conversation }> {
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ title, collectionScopeId }),
    });
    if (!res.ok) throw new Error('Failed to create conversation');
    return res.json();
  },

  async getMessages(conversationId: string): Promise<{ conversation: Conversation; messages: Message[] }> {
    const res = await fetch(`/api/chat/conversations/${conversationId}/messages`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch messages');
    return res.json();
  },

  async deleteConversation(id: string): Promise<{ success: boolean; message?: string }> {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({ error: 'Failed to delete conversation' }));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }
    return res.json();
  },

  // SSE Chat Streaming
  streamChat(
    conversationId: string | null,
    query: string,
    collectionScopeId?: string,
    callbacks?: {
      onChunk?: (chunk: string) => void;
      onCitations?: (citations: Citation[]) => void;
      onMetrics?: (metrics: Partial<QueryMetrics>) => void;
      onDone?: (metrics: QueryMetrics) => void;
      onError?: (err: string) => void;
    }
  ): () => void {
    const controller = new AbortController();

    fetch('/api/chat/stream', {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ conversationId, query, collectionScopeId }),
      signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }
        const reader = response.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'chunk' && event.text && callbacks?.onChunk) {
                  callbacks.onChunk(event.text);
                } else if (event.type === 'citations' && event.citations && callbacks?.onCitations) {
                  callbacks.onCitations(event.citations);
                } else if (event.type === 'metrics' && event.metrics && callbacks?.onMetrics) {
                  callbacks.onMetrics(event.metrics);
                } else if (event.type === 'done' && callbacks?.onDone) {
                  callbacks.onDone(event.metrics);
                } else if (event.type === 'error' && callbacks?.onError) {
                  callbacks.onError(event.error);
                }
              } catch (e) {
                console.error('Error parsing SSE event:', e);
              }
            }
          }
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError' && callbacks?.onError) {
          callbacks.onError(err.message);
        }
      });

    return () => controller.abort();
  },

  // Jobs
  async getJob(id: string): Promise<{ job: ProcessingJob }> {
    const res = await fetch(`/api/jobs/${id}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch job status');
    return res.json();
  },

  async getJobs(): Promise<{ jobs: ProcessingJob[] }> {
    const res = await fetch('/api/jobs', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch jobs');
    return res.json();
  },

  // Notifications
  async getNotifications(limit = 30): Promise<{ notifications: AppNotification[]; unreadCount: number }> {
    const res = await fetch(`/api/notifications?limit=${limit}`, { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Failed to fetch notifications');
    return res.json();
  },

  async markNotificationRead(id: string): Promise<{ success: boolean }> {
    const res = await fetch(`/api/notifications/${id}/read`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to mark notification as read');
    return res.json();
  },

  async markAllNotificationsRead(): Promise<{ success: boolean; markedReadCount: number }> {
    const res = await fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to mark all notifications as read');
    return res.json();
  },

  async clearNotifications(): Promise<{ success: boolean }> {
    const res = await fetch('/api/notifications', {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error('Failed to clear notifications');
    return res.json();
  },
};
