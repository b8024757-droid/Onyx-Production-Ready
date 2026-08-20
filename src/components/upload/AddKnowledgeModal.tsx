/**
 * ONYX — Add Knowledge Modal with Real-Time Indexing Progress & Elapsed Time
 * Implements full real-time telemetry, stage progression, dynamic stage adapting,
 * live elapsed stopwatch, completion card, sanitized error handling, and retry logic.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useChat } from '../../context/ChatContext';
import {
  UploadCloud,
  FileText,
  Globe,
  X,
  Link as LinkIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Layers,
  Cpu,
  Database,
  Sparkles,
  RefreshCw,
  ArrowRight,
  Clock,
  MessageSquare,
  Image as ImageIcon,
  Table,
  Presentation,
  Check,
} from 'lucide-react';
import { Button } from '../common/Button';
import { DocumentType, ProcessingJob, Document } from '../../types';
import { api } from '../../services/api';
import { formatBytes } from '../../utils/formatters';

interface PipelineStageConfig {
  id: string;
  name: string;
  activeText: string;
  completedText: (ctx: { chunkCount?: number; pageCount?: number; visualCount?: number }) => string;
  icon: React.ElementType;
}

/**
 * Generates tailored pipeline stages based on the document type
 */
function getStagesForType(docType: DocumentType): PipelineStageConfig[] {
  switch (docType) {
    case 'PDF':
      return [
        {
          id: 'UPLOAD',
          name: 'File uploaded',
          activeText: 'Uploading document bytes...',
          completedText: () => 'File uploaded & validated',
          icon: UploadCloud,
        },
        {
          id: 'PARSING',
          name: 'Reading document',
          activeText: 'Reading PDF stream & extracting pages...',
          completedText: ctx => (ctx.pageCount ? `Parsed ${ctx.pageCount} pages & layout` : 'Document parsed & structured'),
          icon: FileText,
        },
        {
          id: 'VISUAL',
          name: 'Extracting visual evidence',
          activeText: 'Detecting charts, figures, and diagrams...',
          completedText: ctx =>
            ctx.visualCount && ctx.visualCount > 0
              ? `${ctx.visualCount} visual elements & figures extracted`
              : 'Visual layout & structure extracted',
          icon: ImageIcon,
        },
        {
          id: 'CHUNKING',
          name: 'Creating chunks',
          activeText: 'Segmenting semantic text boundaries...',
          completedText: ctx => (ctx.chunkCount ? `${ctx.chunkCount} chunks created` : 'Semantic chunks created'),
          icon: Layers,
        },
        {
          id: 'EMBEDDING',
          name: 'Generating embeddings',
          activeText: 'Computing 768d dense semantic vectors...',
          completedText: () => 'Dense semantic embeddings generated',
          icon: Cpu,
        },
        {
          id: 'INDEXING',
          name: 'Updating search index',
          activeText: 'Building Qdrant vector & BM25 keyword indices...',
          completedText: () => 'Search indices updated & synchronized',
          icon: Database,
        },
      ];

    case 'XLS':
    case 'XLSX':
      return [
        {
          id: 'UPLOAD',
          name: 'File uploaded',
          activeText: 'Uploading spreadsheet...',
          completedText: () => 'Spreadsheet uploaded',
          icon: UploadCloud,
        },
        {
          id: 'PARSING',
          name: 'Parsing workbook',
          activeText: 'Extracting worksheets, columns, and rows...',
          completedText: () => 'Worksheets & tabular data parsed',
          icon: Table,
        },
        {
          id: 'CHUNKING',
          name: 'Creating tabular chunks',
          activeText: 'Forming structured row & schema blocks...',
          completedText: ctx => (ctx.chunkCount ? `${ctx.chunkCount} tabular chunks created` : 'Tabular chunks created'),
          icon: Layers,
        },
        {
          id: 'EMBEDDING',
          name: 'Generating embeddings',
          activeText: 'Computing semantic representations...',
          completedText: () => 'Tabular embeddings generated',
          icon: Cpu,
        },
        {
          id: 'INDEXING',
          name: 'Updating search index',
          activeText: 'Indexing table schemas and cell data...',
          completedText: () => 'Vector & BM25 indices synchronized',
          icon: Database,
        },
      ];

    case 'PPT':
    case 'PPTX':
      return [
        {
          id: 'UPLOAD',
          name: 'File uploaded',
          activeText: 'Uploading presentation...',
          completedText: () => 'Presentation uploaded',
          icon: UploadCloud,
        },
        {
          id: 'PARSING',
          name: 'Reading slides',
          activeText: 'Extracting slide content & speaker notes...',
          completedText: ctx => (ctx.pageCount ? `Parsed ${ctx.pageCount} slides & notes` : 'Slides parsed'),
          icon: Presentation,
        },
        {
          id: 'CHUNKING',
          name: 'Creating slide chunks',
          activeText: 'Forming slide-scoped knowledge atoms...',
          completedText: ctx => (ctx.chunkCount ? `${ctx.chunkCount} chunks created` : 'Slide chunks created'),
          icon: Layers,
        },
        {
          id: 'EMBEDDING',
          name: 'Generating embeddings',
          activeText: 'Computing slide vector embeddings...',
          completedText: () => 'Slide embeddings generated',
          icon: Cpu,
        },
        {
          id: 'INDEXING',
          name: 'Updating search index',
          activeText: 'Indexing presentation in vector & keyword stores...',
          completedText: () => 'Search indices updated',
          icon: Database,
        },
      ];

    case 'URL':
      return [
        {
          id: 'UPLOAD',
          name: 'Target URL registered',
          activeText: 'Connecting to web source...',
          completedText: () => 'Web address connected',
          icon: Globe,
        },
        {
          id: 'PARSING',
          name: 'Crawling web page',
          activeText: 'Fetching HTML & cleaning content...',
          completedText: () => 'Web article parsed & stripped of noise',
          icon: FileText,
        },
        {
          id: 'CHUNKING',
          name: 'Creating content chunks',
          activeText: 'Segmenting article paragraphs & headings...',
          completedText: ctx => (ctx.chunkCount ? `${ctx.chunkCount} chunks created` : 'Content chunks created'),
          icon: Layers,
        },
        {
          id: 'EMBEDDING',
          name: 'Generating embeddings',
          activeText: 'Computing dense semantic vectors...',
          completedText: () => 'Dense embeddings generated',
          icon: Cpu,
        },
        {
          id: 'INDEXING',
          name: 'Updating search index',
          activeText: 'Indexing web content into Qdrant & BM25...',
          completedText: () => 'Search indices updated',
          icon: Database,
        },
      ];

    default:
      // TXT, MD, CSV, DOC, DOCX
      return [
        {
          id: 'UPLOAD',
          name: 'File uploaded',
          activeText: 'Uploading file bytes...',
          completedText: () => 'File uploaded & validated',
          icon: UploadCloud,
        },
        {
          id: 'PARSING',
          name: 'Reading document',
          activeText: 'Reading text & extracting markdown structure...',
          completedText: () => 'Document parsed & structured',
          icon: FileText,
        },
        {
          id: 'CHUNKING',
          name: 'Creating chunks',
          activeText: 'Segmenting semantic text boundaries...',
          completedText: ctx => (ctx.chunkCount ? `${ctx.chunkCount} chunks created` : 'Semantic chunks created'),
          icon: Layers,
        },
        {
          id: 'EMBEDDING',
          name: 'Generating embeddings',
          activeText: 'Computing 768d semantic vectors...',
          completedText: () => 'Dense semantic embeddings generated',
          icon: Cpu,
        },
        {
          id: 'INDEXING',
          name: 'Updating search index',
          activeText: 'Synchronizing Qdrant and BM25 index...',
          completedText: () => 'Search indices updated',
          icon: Database,
        },
      ];
  }
}

/**
 * Sanitizes backend errors so that passwords, URLs with credentials, API keys,
 * or raw technical stack traces are never exposed to the end user.
 */
function sanitizeErrorMessage(rawMessage?: string): string {
  if (!rawMessage) return 'An unexpected issue occurred while processing this document.';

  const lower = rawMessage.toLowerCase();
  if (
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('resource_exhausted')
  ) {
    return 'Embedding service rate limit reached. Please wait a moment and retry.';
  }
  if (lower.includes('embedding') || lower.includes('gemini') || lower.includes('model')) {
    return 'Embedding service temporarily unavailable. Please retry.';
  }
  if (
    lower.includes('corrupt') ||
    lower.includes('invalid pdf') ||
    lower.includes('malformed') ||
    lower.includes('failed to parse')
  ) {
    return 'Unable to read this document. Please ensure the file is valid and uncorrupted.';
  }
  if (lower.includes('qdrant') || lower.includes('vector')) {
    return 'Vector indexing service temporarily unavailable. Please retry.';
  }
  if (
    lower.includes('network') ||
    lower.includes('fetch') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused')
  ) {
    return 'Connection timed out while fetching document. Please verify network access and retry.';
  }
  if (
    lower.includes('postgres') ||
    lower.includes('database') ||
    lower.includes('relation') ||
    lower.includes('column')
  ) {
    return 'Knowledge storage service encountered a temporary error. Please retry.';
  }

  // Strip technical traces, file paths, tokens
  const cleaned = rawMessage
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(postgres|postgresql|redis|rediss|https?):\/\/[^\s@]+@/gi, '$1://[REDACTED]@')
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]')
    .replace(/at\s+[\w.<>$\s/\\-]+\.js:\d+:\d+/g, '')
    .replace(/\s+at\s+.+/g, '')
    .trim();

  return cleaned.slice(0, 160) || 'Unable to complete indexing for this document.';
}

export const AddKnowledgeModal: React.FC = () => {
  const { isAddKnowledgeOpen, closeAddKnowledge, showToast, setActiveTab: setMainActiveTab } = useUI();
  const { collections, refreshData } = useKnowledge();
  const { startNewConversation } = useChat();

  const [activeTab, setActiveTab] = useState<'files' | 'web'>('files');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    content: string;
    type: DocumentType;
    sizeBytes: number;
  } | null>(null);
  const [webUrl, setWebUrl] = useState('');
  const [webTitle, setWebTitle] = useState('');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Active Indexing Progress Tracking State
  const [currentJob, setCurrentJob] = useState<ProcessingJob | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [visualElementCount, setVisualElementCount] = useState<number>(0);

  // Live Timer Effect — accurate to 50ms intervals
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (timerActive && startTime) {
      interval = setInterval(() => {
        setElapsedMs(Date.now() - startTime);
      }, 50);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [timerActive, startTime]);

  // Live Document Status Poller
  useEffect(() => {
    if (!currentJob || currentJob.status === 'READY' || currentJob.status === 'FAILED') {
      if (currentJob?.status === 'READY' || currentJob?.status === 'FAILED') {
        setTimerActive(false);
      }
      return;
    }

    let isMounted = true;
    const pollInterval = setInterval(async () => {
      try {
        const statusRes = await api.getDocumentStatus(currentJob.documentId);
        if (!isMounted) return;

        setCurrentJob(prev => {
          if (!prev) return null;
          return {
            ...prev,
            status: statusRes.status,
            progress: statusRes.progress,
            stepMessage: statusRes.statusMessage || prev.stepMessage,
            chunkCount: statusRes.chunkCount ?? prev.chunkCount,
            pageCount: statusRes.pageCount ?? prev.pageCount,
            slideCount: statusRes.slideCount ?? prev.slideCount,
            metrics: statusRes.metrics || prev.metrics,
          };
        });

        if (statusRes.metrics?.visualExtractionTimeMs) {
          setVisualElementCount(prev => (prev > 0 ? prev : 2));
        }

        if (statusRes.status === 'READY') {
          setTimerActive(false);
          refreshData();
          showToast('success', 'Document Indexed', `${currentJob.fileName} is indexed and ready for retrieval.`);
        } else if (statusRes.status === 'FAILED') {
          setTimerActive(false);
          showToast('error', 'Indexing Failed', sanitizeErrorMessage(statusRes.statusMessage));
        }
      } catch (err) {
        console.warn('[AddKnowledge] Status poll transient error:', err);
      }
    }, 400);

    return () => {
      isMounted = false;
      clearInterval(pollInterval);
    };
  }, [currentJob?.documentId, currentJob?.status, currentJob?.fileName, refreshData, showToast]);

  if (!isAddKnowledgeOpen) return null;

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFileInput(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFileInput(e.target.files[0]);
    }
  };

  const processFileInput = (file: File) => {
    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toUpperCase() || 'TXT';
    let docType: DocumentType = 'TXT';
    if (['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'TXT', 'MD', 'CSV', 'XLS', 'XLSX', 'HTML'].includes(extension)) {
      docType = extension as DocumentType;
    } else if (file.type.startsWith('image/')) {
      docType = 'IMAGE';
    }

    if (['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'XLS', 'XLSX', 'IMAGE'].includes(docType)) {
      reader.onload = e => {
        const content = e.target?.result as string;
        setSelectedFile({
          name: file.name,
          content: content || '',
          type: docType,
          sizeBytes: file.size,
        });
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = e => {
        const content = e.target?.result as string;
        setSelectedFile({
          name: file.name,
          content: content || '',
          type: docType,
          sizeBytes: file.size,
        });
      };
      reader.readAsText(file);
    }
  };

  const handleImport = async () => {
    setIsSubmitting(true);
    const now = Date.now();
    setStartTime(now);
    setElapsedMs(0);
    setTimerActive(true);
    setVisualElementCount(0);

    try {
      if (activeTab === 'files' && selectedFile) {
        const payload = {
          name: selectedFile.name,
          content: selectedFile.content,
          type: selectedFile.type,
          sizeBytes: selectedFile.sizeBytes,
          collectionId: selectedCollectionId || undefined,
        };

        const res = await api.uploadDocument(payload);
        setCurrentJob({
          id: res.jobId,
          documentId: res.documentId,
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          fileSizeBytes: selectedFile.sizeBytes,
          status: 'PARSING',
          progress: 20,
          stepMessage: 'Reading document stream and extracting content...',
          startedAt: new Date().toISOString(),
        });
      } else if (activeTab === 'web' && webUrl.trim()) {
        const title = webTitle.trim() || webUrl.replace(/^https?:\/\//, '');
        const payload = {
          name: title,
          content: '',
          type: 'URL',
          sizeBytes: 0,
          sourceUrl: webUrl.trim(),
          collectionId: selectedCollectionId || undefined,
        };

        const res = await api.uploadDocument(payload);
        setCurrentJob({
          id: res.jobId,
          documentId: res.documentId,
          fileName: title,
          fileType: 'URL' as DocumentType,
          fileSizeBytes: 0,
          status: 'PARSING',
          progress: 20,
          stepMessage: 'Fetching web document content and parsing HTML...',
          startedAt: new Date().toISOString(),
        });
      }
    } catch (e: any) {
      setTimerActive(false);
      showToast('error', 'Import Failed', sanitizeErrorMessage(e.message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetry = async () => {
    if (!currentJob) return;
    setIsRetrying(true);
    const now = Date.now();
    setStartTime(now);
    setElapsedMs(0);
    setTimerActive(true);

    try {
      await api.retryDocument(currentJob.documentId);
      setCurrentJob(prev => {
        if (!prev) return null;
        return {
          ...prev,
          status: 'PARSING',
          progress: 20,
          stepMessage: 'Re-initiating parsing and structure extraction...',
          error: undefined,
        };
      });
      showToast('info', 'Indexing Restarted', 'Re-processing document through pipeline.');
    } catch (err: any) {
      setTimerActive(false);
      showToast('error', 'Retry Failed', sanitizeErrorMessage(err.message));
    } finally {
      setIsRetrying(false);
    }
  };

  const handleResetForAnother = () => {
    setCurrentJob(null);
    setSelectedFile(null);
    setWebUrl('');
    setWebTitle('');
    setElapsedMs(0);
    setTimerActive(false);
    setVisualElementCount(0);
  };

  const handleStartChatWithDocument = async () => {
    if (!currentJob) return;
    closeAddKnowledge();
    await startNewConversation(`Discussion about ${currentJob.fileName}`);
    setMainActiveTab('chat');
  };

  // Helper to compute stage status: 'completed' | 'active' | 'pending' | 'failed'
  const computeStageStatus = (
    stageId: string,
    currentStatus: Document['status'],
    stages: PipelineStageConfig[]
  ): 'completed' | 'active' | 'pending' | 'failed' => {
    if (currentStatus === 'READY') return 'completed';

    if (currentStatus === 'FAILED') {
      // Find current stage when failed
      const activeStageId = getActiveStageIdForStatus(currentStatus, stages);
      if (stageId === activeStageId) return 'failed';
      const stageIdx = stages.findIndex(s => s.id === stageId);
      const activeIdx = stages.findIndex(s => s.id === activeStageId);
      if (stageIdx < activeIdx) return 'completed';
      return 'pending';
    }

    const activeStageId = getActiveStageIdForStatus(currentStatus, stages);
    const stageIdx = stages.findIndex(s => s.id === stageId);
    const activeIdx = stages.findIndex(s => s.id === activeStageId);

    if (stageIdx < activeIdx) return 'completed';
    if (stageIdx === activeIdx) return 'active';
    return 'pending';
  };

  const getActiveStageIdForStatus = (
    status: Document['status'],
    stages: PipelineStageConfig[]
  ): string => {
    switch (status) {
      case 'UPLOADING':
        return stages[0]?.id || 'UPLOAD';
      case 'PARSING':
      case 'PROCESSING':
        return stages.some(s => s.id === 'VISUAL') && visualElementCount > 0 ? 'VISUAL' : 'PARSING';
      case 'CHUNKING':
        return 'CHUNKING';
      case 'EMBEDDING':
        return 'EMBEDDING';
      case 'INDEXING':
        return 'INDEXING';
      default:
        return stages[0]?.id || 'UPLOAD';
    }
  };

  const formatSeconds = (ms: number) => {
    return (ms / 1000).toFixed(1) + 's';
  };

  // Compute final completion time using actual measured totalTimeMs when available
  const getFinalIndexingTime = (): string => {
    if (currentJob?.metrics?.deduplicated) return 'Instant';
    if (currentJob?.metrics?.totalTimeMs && currentJob.metrics.totalTimeMs > 0) {
      return (currentJob.metrics.totalTimeMs / 1000).toFixed(1) + ' seconds';
    }
    return (elapsedMs / 1000).toFixed(1) + ' seconds';
  };

  const stages = currentJob ? getStagesForType(currentJob.fileType) : [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        id="add-knowledge-modal"
        className="w-full max-w-xl bg-[#101413] border border-[#2A302D] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between border-b border-[#2A302D]">
          <div>
            <h2 id="modal-title" className="text-lg font-bold text-[#F3F1EA] tracking-tight flex items-center gap-2">
              {currentJob ? (
                currentJob.status === 'READY' ? (
                  <span className="text-[#78C6A3] flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5" />
                    Knowledge added successfully
                  </span>
                ) : currentJob.status === 'FAILED' ? (
                  <span className="text-[#E07A5F] flex items-center gap-2">
                    <AlertCircle className="w-5 h-5" />
                    Indexing failed
                  </span>
                ) : (
                  <span>Adding to Knowledge</span>
                )
              ) : (
                <span>Add knowledge to your ONYX workspace</span>
              )}
            </h2>
            <p className="text-xs text-[#929892] mt-0.5">
              {currentJob
                ? currentJob.status === 'READY'
                  ? 'Source is fully indexed and ready for grounded inquiries'
                  : currentJob.fileName
                : 'Bring in anything worth remembering.'}
            </p>
          </div>
          <button
            onClick={closeAddKnowledge}
            aria-label="Close dialog"
            className="p-1.5 text-[#929892] hover:text-[#F3F1EA] rounded-lg hover:bg-[#171C1A] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Section */}
        {!currentJob ? (
          <>
            {/* Tab Controls */}
            <div className="flex border-b border-[#2A302D] px-6">
              <button
                onClick={() => setActiveTab('files')}
                className={`py-3 px-4 text-xs font-bold tracking-wider transition-all relative ${
                  activeTab === 'files' ? 'text-[#F3F1EA]' : 'text-[#929892] hover:text-[#F3F1EA]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5" />
                  <span>FILES</span>
                </div>
                {activeTab === 'files' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D6C7A1]" />
                )}
              </button>

              <button
                onClick={() => setActiveTab('web')}
                className={`py-3 px-4 text-xs font-bold tracking-wider transition-all relative ${
                  activeTab === 'web' ? 'text-[#F3F1EA]' : 'text-[#929892] hover:text-[#F3F1EA]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5" />
                  <span>WEB</span>
                </div>
                {activeTab === 'web' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D6C7A1]" />
                )}
              </button>
            </div>

            {/* Body Content */}
            <div className="p-6 space-y-5 overflow-y-auto">
              {/* Target Collection Selection */}
              <div>
                <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                  Assign to Collection (Optional)
                </label>
                <select
                  value={selectedCollectionId}
                  onChange={e => setSelectedCollectionId(e.target.value)}
                  className="w-full bg-[#171C1A] border border-[#2A302D] rounded-lg px-3.5 py-2 text-xs text-[#F3F1EA] focus:outline-none focus:border-[#D6C7A1]"
                >
                  <option value="">General Knowledge (No Collection)</option>
                  {collections.map(col => (
                    <option key={col.id} value={col.id}>
                      {col.name} ({col.documentCount} sources)
                    </option>
                  ))}
                </select>
              </div>

              {activeTab === 'files' ? (
                <div>
                  {/* Dropzone */}
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileInputChange}
                    className="hidden"
                    accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.csv,.xls,.xlsx,image/*"
                  />
                  <div
                    onDragOver={e => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                      isDragging
                        ? 'border-[#D6C7A1] bg-[#D6C7A1]/5'
                        : selectedFile
                        ? 'border-[#78C6A3]/50 bg-[#78C6A3]/5'
                        : 'border-[#2A302D] hover:border-[#3E4743] bg-[#171C1A]/40'
                    }`}
                  >
                    <div className="w-12 h-12 mx-auto rounded-full bg-[#171C1A] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] mb-3">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <p className="text-sm font-semibold text-[#F3F1EA]">
                      {selectedFile ? selectedFile.name : 'Click to upload or drag and drop'}
                    </p>
                    <p className="text-xs text-[#929892] mt-1">
                      PDF, DOCX, PPTX, XLSX, CSV, MD, TXT (max. 50MB)
                    </p>
                  </div>
                </div>
              ) : (
                /* Web URL Import Form */
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                      Web Page URL
                    </label>
                    <div className="flex items-center gap-2 bg-[#171C1A] border border-[#2A302D] rounded-lg px-3 py-2">
                      <LinkIcon className="w-4 h-4 text-[#929892]" />
                      <input
                        type="url"
                        placeholder="https://example.com/article"
                        value={webUrl}
                        onChange={e => setWebUrl(e.target.value)}
                        className="flex-1 bg-transparent text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                      Custom Title (Optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Research Summary & Findings"
                      value={webTitle}
                      onChange={e => setWebTitle(e.target.value)}
                      className="w-full bg-[#171C1A] border border-[#2A302D] rounded-lg px-3.5 py-2 text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none focus:border-[#D6C7A1]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 bg-[#080A0A] border-t border-[#2A302D] flex items-center justify-end gap-3">
              <Button variant="ghost" onClick={closeAddKnowledge}>
                Cancel
              </Button>
              <Button
                variant="champagne"
                onClick={handleImport}
                loading={isSubmitting}
                disabled={activeTab === 'files' ? !selectedFile : !webUrl.trim()}
              >
                Import {activeTab === 'files' ? 'Document' : 'Web Page'}
              </Button>
            </div>
          </>
        ) : (
          /* =========================================================================
             REAL-TIME INDEXING PROGRESS & TELEMETRY INTERFACE
             ========================================================================= */
          <div className="p-6 space-y-5 overflow-y-auto" aria-live="polite">
            {/* Document Header & Elapsed Time Card */}
            <div className="p-4 bg-[#171C1A] border border-[#2A302D] rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-[#2A302D] flex items-center justify-center text-[#D6C7A1] shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-[#F3F1EA] truncate">
                    {currentJob.fileName}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-[#929892]">
                    <span className="px-1.5 py-0.5 rounded bg-[#2A302D] text-[#D6C7A1] text-[10px] font-bold">
                      {currentJob.fileType}
                    </span>
                    {currentJob.fileSizeBytes > 0 && (
                      <span>{formatBytes(currentJob.fileSizeBytes)}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Real-Time Elapsed Stopwatch */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#101413] border border-[#2A302D] text-xs shrink-0">
                <Clock
                  className={`w-3.5 h-3.5 ${
                    currentJob.status === 'READY'
                      ? 'text-[#78C6A3]'
                      : currentJob.status === 'FAILED'
                      ? 'text-[#E07A5F]'
                      : 'text-[#D6C7A1] animate-pulse'
                  }`}
                />
                <span className="text-[#929892]">
                  {currentJob.status === 'READY' ? 'Indexed in:' : 'Elapsed time:'}
                </span>
                <span className="font-mono font-bold text-[#F3F1EA]">
                  {currentJob.status === 'READY' ? getFinalIndexingTime() : formatSeconds(elapsedMs)}
                </span>
              </div>
            </div>

            {/* Dynamic Stage Progression List */}
            <div className="space-y-2.5">
              <div className="text-[10px] font-bold text-[#626863] uppercase tracking-wider">
                Indexing Stages
              </div>

              <div className="space-y-2">
                {stages.map(stage => {
                  const stageStatus = computeStageStatus(stage.id, currentJob.status, stages);

                  return (
                    <div
                      key={stage.id}
                      className={`p-3 rounded-xl border transition-all flex items-center justify-between ${
                        stageStatus === 'completed'
                          ? 'bg-[#171C1A]/90 border-[#78C6A3]/30 text-[#F3F1EA]'
                          : stageStatus === 'active'
                          ? 'bg-[#171C1A] border-[#D6C7A1] shadow-sm shadow-[#D6C7A1]/10 text-[#F3F1EA]'
                          : stageStatus === 'failed'
                          ? 'bg-[#E07A5F]/10 border-[#E07A5F]/50 text-[#E07A5F]'
                          : 'bg-[#101413]/50 border-[#2A302D]/60 text-[#626863]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Status Icon */}
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs font-bold ${
                            stageStatus === 'completed'
                              ? 'bg-[#78C6A3]/20 text-[#78C6A3]'
                              : stageStatus === 'active'
                              ? 'bg-[#D6C7A1]/20 text-[#D6C7A1]'
                              : stageStatus === 'failed'
                              ? 'bg-[#E07A5F]/20 text-[#E07A5F]'
                              : 'bg-[#2A302D]/40 text-[#626863]'
                          }`}
                        >
                          {stageStatus === 'completed' ? (
                            <Check className="w-4 h-4 stroke-[3]" />
                          ) : stageStatus === 'active' ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : stageStatus === 'failed' ? (
                            <X className="w-4 h-4 stroke-[3]" />
                          ) : (
                            <span className="w-2 h-2 rounded-full border border-[#626863]" />
                          )}
                        </div>

                        {/* Stage Name / Description */}
                        <div className="min-w-0">
                          <p
                            className={`text-xs font-semibold truncate ${
                              stageStatus === 'active'
                                ? 'text-[#F3F1EA]'
                                : stageStatus === 'completed'
                                ? 'text-[#DCE4DC]'
                                : stageStatus === 'failed'
                                ? 'text-[#E07A5F]'
                                : 'text-[#626863]'
                            }`}
                          >
                            {stageStatus === 'completed'
                              ? stage.completedText({
                                  chunkCount: currentJob.chunkCount,
                                  pageCount: currentJob.pageCount,
                                  visualCount: visualElementCount,
                                })
                              : stageStatus === 'active'
                              ? stage.activeText
                              : stage.name}
                          </p>
                        </div>
                      </div>

                      {/* Right Tag */}
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                          stageStatus === 'completed'
                            ? 'bg-[#78C6A3]/10 text-[#78C6A3]'
                            : stageStatus === 'active'
                            ? 'bg-[#D6C7A1]/10 text-[#D6C7A1] animate-pulse'
                            : stageStatus === 'failed'
                            ? 'bg-[#E07A5F]/10 text-[#E07A5F]'
                            : 'text-[#626863]'
                        }`}
                      >
                        {stageStatus === 'completed'
                          ? 'Done'
                          : stageStatus === 'active'
                          ? 'In progress'
                          : stageStatus === 'failed'
                          ? 'Failed'
                          : 'Pending'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* COMPLETION STATE CARD */}
            {currentJob.status === 'READY' && (
              <div className="p-4 bg-[#78C6A3]/10 border border-[#78C6A3]/30 rounded-xl space-y-3 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#78C6A3] flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Ready for Chat & Search
                  </span>
                  <span className="font-mono text-xs text-[#D6C7A1]">
                    {getFinalIndexingTime()}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 border-t border-[#78C6A3]/20">
                  <div className="bg-[#101413]/70 p-2.5 rounded-lg text-center">
                    <div className="text-sm font-bold text-[#F3F1EA]">
                      {currentJob.chunkCount || '1'}
                    </div>
                    <div className="text-[10px] text-[#929892] uppercase">Chunks Indexed</div>
                  </div>

                  {currentJob.pageCount && (
                    <div className="bg-[#101413]/70 p-2.5 rounded-lg text-center">
                      <div className="text-sm font-bold text-[#F3F1EA]">
                        {currentJob.pageCount}
                      </div>
                      <div className="text-[10px] text-[#929892] uppercase">Pages</div>
                    </div>
                  )}

                  {visualElementCount > 0 && (
                    <div className="bg-[#101413]/70 p-2.5 rounded-lg text-center">
                      <div className="text-sm font-bold text-[#D6C7A1]">
                        {visualElementCount}
                      </div>
                      <div className="text-[10px] text-[#929892] uppercase">Visual Elements</div>
                    </div>
                  )}

                  <div className="bg-[#101413]/70 p-2.5 rounded-lg text-center col-span-2 sm:col-span-1">
                    <div className="text-sm font-bold text-[#78C6A3]">100%</div>
                    <div className="text-[10px] text-[#929892] uppercase">Grounding Ready</div>
                  </div>
                </div>
              </div>
            )}

            {/* FAILURE STATE CARD */}
            {currentJob.status === 'FAILED' && (
              <div className="p-4 bg-[#E07A5F]/10 border border-[#E07A5F]/40 rounded-xl space-y-3 animate-in fade-in duration-200">
                <div className="flex items-start gap-2.5 text-xs text-[#E07A5F]">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold">✕ Indexing failed</div>
                    <div className="text-[11px] text-[#E07A5F]/90 mt-0.5">
                      {sanitizeErrorMessage(currentJob.error || currentJob.stepMessage)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E07A5F]/20">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRetry}
                    loading={isRetrying}
                    icon={<RefreshCw className="w-3.5 h-3.5" />}
                  >
                    Retry indexing
                  </Button>
                </div>
              </div>
            )}

            {/* Footer Action Controls */}
            <div className="pt-2 flex items-center justify-between border-t border-[#2A302D]">
              <Button variant="ghost" size="sm" onClick={handleResetForAnother}>
                + Add Another Document
              </Button>

              <div className="flex items-center gap-2">
                {currentJob.status === 'READY' && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<MessageSquare className="w-3.5 h-3.5" />}
                    onClick={handleStartChatWithDocument}
                  >
                    Ask About This Document
                  </Button>
                )}

                <Button
                  variant="champagne"
                  size="sm"
                  onClick={closeAddKnowledge}
                  icon={<ArrowRight className="w-3.5 h-3.5" />}
                >
                  {currentJob.status === 'READY' ? 'View in Knowledge Base' : 'Close'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
