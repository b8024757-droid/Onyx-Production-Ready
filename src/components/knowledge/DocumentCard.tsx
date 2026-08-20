/**
 * Second Brain — Document Card Component with ONYX Status & Indexing Metadata
 */

import React from 'react';
import { Document } from '../../types';
import { getDocumentTypeBadge, formatRelativeTime } from '../../utils/formatters';
import { Trash2, CheckCircle2, Loader2, AlertCircle, Sparkles } from 'lucide-react';

interface DocumentCardProps {
  document: Document;
  onSelect: (doc: Document) => void;
  onDelete: (id: string) => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({ document, onSelect, onDelete }) => {
  const badge = getDocumentTypeBadge(document.type);

  // Format indexing timing
  const formatIndexingTime = () => {
    if (!document.metrics) return null;
    if (document.metrics.deduplicated) return 'Instant';
    if (document.metrics.totalTimeMs) {
      return `${(document.metrics.totalTimeMs / 1000).toFixed(1)}s`;
    }
    return null;
  };

  const indexingTimeStr = formatIndexingTime();

  return (
    <div
      onClick={() => onSelect(document)}
      className="p-5 rounded-2xl bg-[#101413] border border-[#2A302D] hover:border-[#3E4743] flex flex-col justify-between transition-all group cursor-pointer hover:shadow-xl hover:shadow-black/40"
    >
      <div>
        {/* Top Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-md"
              style={{ color: badge.color, backgroundColor: badge.bg }}
            >
              {badge.label}
            </span>

            {/* Status Pill */}
            {document.status === 'READY' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#78C6A3] bg-[#78C6A3]/10 px-2 py-0.5 rounded-md">
                <CheckCircle2 className="w-3 h-3 text-[#78C6A3]" />
                Ready
              </span>
            ) : document.status === 'FAILED' ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#E07A5F] bg-[#E07A5F]/10 px-2 py-0.5 rounded-md">
                <AlertCircle className="w-3 h-3 text-[#E07A5F]" />
                Failed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#D6C7A1] bg-[#D6C7A1]/10 px-2 py-0.5 rounded-md">
                <Loader2 className="w-3 h-3 text-[#D6C7A1] animate-spin" />
                Indexing
              </span>
            )}
          </div>

          <button
            onClick={e => {
              e.stopPropagation();
              onDelete(document.id);
            }}
            className="text-[#626863] hover:text-red-400 p-1 rounded transition-colors opacity-0 group-hover:opacity-100"
            title="Delete Document"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Title & Summary */}
        <h3 className="text-sm font-bold text-[#F3F1EA] group-hover:text-[#D6C7A1] transition-colors mt-3 line-clamp-1">
          {document.title}
        </h3>
        <p className="text-xs text-[#929892] mt-1.5 line-clamp-2 leading-relaxed">
          {document.summary || document.contentPreview || 'Indexed knowledge item.'}
        </p>
      </div>

      {/* Footer Metadata */}
      <div className="mt-4 pt-3 border-t border-[#2A302D] flex items-center justify-between text-[11px] text-[#626863]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[#929892]">{document.chunkCount || 1} chunks</span>
          {document.pageCount && (
            <>
              <span>·</span>
              <span>{document.pageCount} pages</span>
            </>
          )}
          {document.slideCount && (
            <>
              <span>·</span>
              <span>{document.slideCount} slides</span>
            </>
          )}
          {indexingTimeStr && (
            <>
              <span>·</span>
              <span className="text-[#D6C7A1]">{indexingTimeStr}</span>
            </>
          )}
        </div>
        <span>{formatRelativeTime(document.createdAt)}</span>
      </div>
    </div>
  );
};
