/**
 * Second Brain — Recent Knowledge List Component
 */

import React from 'react';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useUI } from '../../context/UIContext';
import { getDocumentTypeBadge, formatRelativeTime } from '../../utils/formatters';
import { ChevronRight, ArrowUpRight } from 'lucide-react';

export const RecentKnowledge: React.FC = () => {
  const { documents } = useKnowledge();
  const { setActiveTab } = useUI();

  const recentDocs = documents.slice(0, 4);

  return (
    <div className="rounded-2xl bg-[#101413] border border-[#2A302D] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#F3F1EA] tracking-wide">
          Recent Knowledge
        </h3>
        <button
          onClick={() => setActiveTab('knowledge')}
          className="text-xs font-semibold text-[#D6C7A1] hover:text-[#F0E4C2] flex items-center gap-1 transition-colors"
        >
          <span>View All</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="space-y-2.5">
        {recentDocs.map(doc => {
          const badge = getDocumentTypeBadge(doc.type);
          return (
            <div
              key={doc.id}
              onClick={() => setActiveTab('knowledge')}
              className="p-3.5 rounded-xl bg-[#171C1A] hover:bg-[#1C2220] border border-[#2A302D] hover:border-[#3E4743] flex items-center justify-between cursor-pointer transition-all group"
            >
              <div className="flex items-center gap-3.5">
                <span
                  className="text-[11px] font-bold px-2 py-1 rounded-md"
                  style={{ color: badge.color, backgroundColor: badge.bg }}
                >
                  {badge.label}
                </span>

                <div>
                  <h4 className="text-xs font-semibold text-[#F3F1EA] group-hover:text-[#D6C7A1] transition-colors">
                    {doc.title}
                  </h4>
                  <p className="text-[11px] text-[#929892] mt-0.5">
                    {doc.type} · {doc.collectionName || 'General'} · {doc.chunkCount || 12} units
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#626863]">
                  {formatRelativeTime(doc.createdAt)}
                </span>
                <ArrowUpRight className="w-3.5 h-3.5 text-[#626863] group-hover:text-[#F3F1EA] transition-colors opacity-0 group-hover:opacity-100" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
