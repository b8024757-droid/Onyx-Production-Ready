/**
 * Second Brain — Document Detail & Chunk Inspector Modal
 */

import React, { useState, useEffect } from 'react';
import { Document, Chunk } from '../../types';
import { api } from '../../services/api';
import { useUI } from '../../context/UIContext';
import { useChat } from '../../context/ChatContext';
import { X, FileText, Layers, MessageSquare, ExternalLink, Calendar, Database, Trash2, Zap, Clock } from 'lucide-react';
import { getDocumentTypeBadge, formatBytes, formatRelativeTime } from '../../utils/formatters';
import { Button } from '../common/Button';

interface DocumentDetailModalProps {
  document: Document | null;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export const DocumentDetailModal: React.FC<DocumentDetailModalProps> = ({ document, onClose, onDelete }) => {
  const { setActiveTab } = useUI();
  const { startNewConversation } = useChat();
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (document) {
      setIsLoading(true);
      api
        .getDocument(document.id)
        .then(res => setChunks(res.chunks))
        .catch(err => console.error('Failed to load chunks:', err))
        .finally(() => setIsLoading(false));
    }
  }, [document]);

  if (!document) return null;

  const badge = getDocumentTypeBadge(document.type);

  const handleAskAboutDoc = async () => {
    onClose();
    await startNewConversation(`Inquiry about ${document.title}`);
    setActiveTab('chat');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        id="document-detail-modal"
        className="w-full max-w-3xl max-h-[88vh] bg-[#101413] border border-[#2A302D] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#2A302D] flex items-start justify-between">
          <div className="flex items-start gap-3.5">
            <span
              className="text-xs font-bold px-2.5 py-1 rounded-md mt-0.5"
              style={{ color: badge.color, backgroundColor: badge.bg }}
            >
              {badge.label}
            </span>
            <div>
              <h2 className="text-base font-bold text-[#F3F1EA] tracking-tight">
                {document.title}
              </h2>
              <p className="text-xs text-[#929892] mt-0.5">
                {document.originalName} · {document.collectionName || 'General Knowledge'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onDelete(document.id);
                onClose();
              }}
              className="p-2 text-[#626863] hover:text-red-400 rounded-lg hover:bg-[#171C1A] transition-colors"
              title="Delete Document"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[#929892] hover:text-[#F3F1EA] rounded-lg hover:bg-[#171C1A] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Metadata Bar */}
        <div className="px-6 py-3 bg-[#171C1A]/50 border-b border-[#2A302D] flex flex-wrap items-center gap-6 text-xs text-[#929892]">
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-[#D6C7A1]" />
            <span>{chunks.length} Semantic Chunks</span>
          </div>
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-[#78C6A3]" />
            <span>{formatBytes(document.sizeBytes)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-[#929892]" />
            <span>Added {new Date(document.createdAt).toLocaleDateString()}</span>
          </div>
          {document.metrics && (
            <div className="flex items-center gap-2 text-[#D6C7A1]">
              <Zap className="w-3.5 h-3.5 text-[#D6C7A1]" />
              <span>{document.metrics.deduplicated ? 'Instant Deduplicated' : `${document.metrics.totalTimeMs}ms total`}</span>
            </div>
          )}
          {document.sourceUrl && (
            <a
              href={document.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[#D6C7A1] hover:underline ml-auto"
            >
              <span>Source URL</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* Indexing Performance Breakdown (if available) */}
        {document.metrics && !document.metrics.deduplicated && (
          <div className="px-6 py-2.5 bg-[#121715] border-b border-[#2A302D] flex flex-wrap items-center gap-4 text-[11px] text-[#626863]">
            <span className="text-[#929892] font-semibold">Indexing Latency:</span>
            <span>Parse: <strong className="text-[#F3F1EA]">{document.metrics.parsingTimeMs}ms</strong></span>
            <span>Chunk: <strong className="text-[#F3F1EA]">{document.metrics.chunkingTimeMs}ms</strong></span>
            <span>Embed: <strong className="text-[#D6C7A1]">{document.metrics.embeddingTimeMs}ms</strong></span>
            <span>Qdrant: <strong className="text-[#78C6A3]">{document.metrics.qdrantTimeMs}ms</strong></span>
            <span>BM25: <strong className="text-[#78C6A3]">{document.metrics.bm25TimeMs}ms</strong></span>
          </div>
        )}

        {/* Content Chunks View */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <h3 className="text-xs font-bold text-[#626863] uppercase tracking-wider">
            INDEXED PASSAGES & EMBEDDINGS
          </h3>

          {isLoading ? (
            <div className="py-12 text-center text-xs text-[#929892]">
              Loading semantic units...
            </div>
          ) : chunks.length === 0 ? (
            <div className="p-4 bg-[#171C1A] border border-[#2A302D] rounded-xl text-xs text-[#929892]">
              {document.contentPreview || 'No chunk breakdowns available for this file.'}
            </div>
          ) : (
            chunks.map((chunk, idx) => (
              <div
                key={chunk.id || idx}
                className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] space-y-2"
              >
                <div className="flex items-center justify-between text-[11px] text-[#929892] border-b border-[#2A302D]/60 pb-2">
                  <span className="font-semibold text-[#D6C7A1]">
                    Unit #{idx + 1} {chunk.sectionHeader ? `· ${chunk.sectionHeader}` : ''}
                  </span>
                  <span>{chunk.tokenCount} Tokens {chunk.pageNumber ? `· Page ${chunk.pageNumber}` : ''}</span>
                </div>
                <p className="text-xs text-[#F3F1EA] leading-relaxed whitespace-pre-wrap font-sans">
                  {chunk.content}
                </p>
              </div>
            ))
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-[#080A0A] border-t border-[#2A302D] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {document.tags.map(t => (
              <span key={t} className="text-[10px] px-2 py-0.5 rounded bg-[#171C1A] text-[#929892] border border-[#2A302D]">
                {t}
              </span>
            ))}
          </div>

          <Button variant="champagne" size="sm" icon={<MessageSquare className="w-3.5 h-3.5" />} onClick={handleAskAboutDoc}>
            Ask About This Document
          </Button>
        </div>
      </div>
    </div>
  );
};
