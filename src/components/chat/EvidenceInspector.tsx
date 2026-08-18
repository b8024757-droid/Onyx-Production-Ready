/**
 * Second Brain — Evidence Inspector Sidebar Component
 * Matches Stitch visual design from Image 5 & 12
 */

import React from 'react';
import { useUI } from '../../context/UIContext';
import { useKnowledge } from '../../context/KnowledgeContext';
import { X, FileText, ExternalLink, Quote, Sparkles, Database } from 'lucide-react';
import { getDocumentTypeBadge } from '../../utils/formatters';

export const EvidenceInspector: React.FC = () => {
  const { activeEvidenceCitation, inspectCitation, setActiveTab } = useUI();
  const { documents } = useKnowledge();

  if (!activeEvidenceCitation) return null;

  const badge = getDocumentTypeBadge(activeEvidenceCitation.sourceType);
  const citationNum =
    activeEvidenceCitation.citationIndex < 10
      ? `0${activeEvidenceCitation.citationIndex}`
      : `${activeEvidenceCitation.citationIndex}`;

  const relatedDoc = documents.find(d => d.id === activeEvidenceCitation.documentId);

  return (
    <aside
      id="evidence-inspector"
      className="w-80 lg:w-96 flex-shrink-0 h-full bg-[#101413] border-l border-[#2A302D] flex flex-col justify-between p-6 animate-in slide-in-from-right duration-200 z-20 overflow-y-auto"
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#2A302D] pb-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#78C6A3] animate-pulse" />
            <h3 className="text-xs font-bold tracking-widest text-[#F3F1EA] uppercase">
              EVIDENCE INSPECTOR
            </h3>
          </div>
          <button
            onClick={() => inspectCitation(null)}
            className="p-1 text-[#929892] hover:text-[#F3F1EA] rounded-md hover:bg-[#171C1A] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Source Document Card */}
        <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] flex-shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-bold text-[#F3F1EA] truncate">
                {activeEvidenceCitation.documentTitle}
              </h4>
              <p className="text-[10px] font-mono font-semibold text-[#929892] mt-0.5 uppercase tracking-wider">
                {activeEvidenceCitation.pageNumber ? `PAGE ${activeEvidenceCitation.pageNumber} · ` : ''}
                CITATION {citationNum}
              </p>
            </div>
          </div>

          <button
            onClick={() => setActiveTab('knowledge')}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-[#101413] hover:bg-[#1C2220] border border-[#2A302D] hover:border-[#3E4743] text-xs font-medium text-[#F3F1EA] transition-colors"
          >
            <span>Open Document</span>
            <ExternalLink className="w-3 h-3 text-[#929892]" />
          </button>
        </div>

        {/* Extracted Passage Box (Matching Stitch design with Quote mark) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-bold text-[#626863] uppercase tracking-wider">
              {activeEvidenceCitation.isVisual ? 'VISUAL EVIDENCE' : 'EXTRACTED PASSAGE'}
            </div>
            {activeEvidenceCitation.visualType && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#D6C7A1]/15 text-[#D6C7A1] border border-[#D6C7A1]/30 uppercase">
                {activeEvidenceCitation.visualType}
              </span>
            )}
          </div>

          {activeEvidenceCitation.figureId && (
            <div className="p-2.5 rounded-lg bg-[#101413] border border-[#2A302D] text-xs font-semibold text-[#D6C7A1]">
              {activeEvidenceCitation.figureId}
              {activeEvidenceCitation.figureTitle ? ` — ${activeEvidenceCitation.figureTitle}` : ''}
            </div>
          )}

          <div className="relative p-4 rounded-xl bg-[#171C1A]/70 border border-[#2A302D] text-xs leading-relaxed text-[#F3F1EA] font-sans">
            <span className="text-lg text-[#D6C7A1]/40 font-serif leading-none mr-1 select-none">
              “
            </span>
            <span>{activeEvidenceCitation.excerpt}</span>
            <span className="text-lg text-[#D6C7A1]/40 font-serif leading-none ml-1 select-none">
              ”
            </span>
          </div>

          {activeEvidenceCitation.trendSummary && (
            <div className="p-3 rounded-lg bg-[#101413]/80 border border-[#2A302D] space-y-1 text-xs">
              <div className="text-[10px] font-bold text-[#78C6A3] uppercase tracking-wider">
                Observed Trend / Pattern
              </div>
              <p className="text-[#929892] leading-relaxed">
                {activeEvidenceCitation.trendSummary}
              </p>
            </div>
          )}

          {(activeEvidenceCitation.axes?.x || activeEvidenceCitation.axes?.y) && (
            <div className="p-2.5 rounded-lg bg-[#101413]/60 border border-[#2A302D] text-[11px] text-[#929892] space-y-1">
              {activeEvidenceCitation.axes.x && (
                <div><span className="text-[#626863] font-semibold">X-Axis:</span> {activeEvidenceCitation.axes.x}</div>
              )}
              {activeEvidenceCitation.axes.y && (
                <div><span className="text-[#626863] font-semibold">Y-Axis:</span> {activeEvidenceCitation.axes.y}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer Metadata */}
      <div className="pt-6 border-t border-[#2A302D] space-y-2 text-[11px] text-[#929892]">
        <div className="flex items-center justify-between">
          <span className="text-[#626863] uppercase font-bold text-[10px]">ADDED</span>
          <span className="text-[#F3F1EA]">{activeEvidenceCitation.addedDate || 'Oct 24, 2023'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#626863] uppercase font-bold text-[10px]">COLLECTION</span>
          <span className="text-[#D6C7A1]">{activeEvidenceCitation.collectionName || 'General Knowledge'}</span>
        </div>
        {activeEvidenceCitation.score && (
          <div className="flex items-center justify-between">
            <span className="text-[#626863] uppercase font-bold text-[10px]">MATCH SCORE</span>
            <span className="text-[#78C6A3] font-bold">{Math.round(activeEvidenceCitation.score * 100)}% Match</span>
          </div>
        )}
      </div>
    </aside>
  );
};
