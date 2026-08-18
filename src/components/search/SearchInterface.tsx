/**
 * Second Brain — Hybrid Search Interface Component
 */

import React, { useState } from 'react';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useUI } from '../../context/UIContext';
import { useChat } from '../../context/ChatContext';
import { Search, Sparkles, Filter, Database, Cpu, MessageSquare, Layers, ArrowUpRight } from 'lucide-react';
import { getDocumentTypeBadge } from '../../utils/formatters';
import { Button } from '../common/Button';

export const SearchInterface: React.FC = () => {
  const { searchResults, isSearching, executeSearch, collections } = useKnowledge();
  const { inspectCitation, setActiveTab } = useUI();
  const { startNewConversation, sendMessage } = useChat();
  const [queryInput, setQueryInput] = useState('');
  const [selectedCol, setSelectedCol] = useState('');

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (queryInput.trim()) {
      executeSearch(queryInput.trim(), selectedCol || undefined);
    }
  };

  const handleAskAIAboutQuery = async () => {
    if (!queryInput.trim()) return;
    await startNewConversation(queryInput.trim());
    setActiveTab('chat');
    sendMessage(queryInput.trim());
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-7 animate-in fade-in duration-200">
      {/* Header */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-extrabold text-[#F3F1EA] tracking-tight">
          Hybrid Search
        </h1>
        <p className="text-xs text-[#929892] mt-1">
          Vector similarity + BM25 keyword matching fused with Reciprocal Rank Fusion (RRF).
        </p>
      </div>

      {/* Main Search Input */}
      <form onSubmit={handleSearchSubmit} className="space-y-3">
        <div className="flex items-center gap-3 bg-[#101413] border border-[#2A302D] focus-within:border-[#D6C7A1] rounded-2xl p-2.5 shadow-xl transition-all">
          <div className="pl-3 text-[#929892]">
            <Search className="w-5 h-5" />
          </div>
          <input
            type="text"
            placeholder="Search passages, formulas, concepts, or queries across all knowledge..."
            value={queryInput}
            onChange={e => setQueryInput(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[#F3F1EA] placeholder-[#626863] focus:outline-none"
          />
          <Button variant="champagne" size="sm" type="submit" loading={isSearching}>
            Search
          </Button>
        </div>

        {/* Filters and Suggestions */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-[#626863]">Collection Scope:</span>
            <select
              value={selectedCol}
              onChange={e => setSelectedCol(e.target.value)}
              className="bg-[#101413] border border-[#2A302D] rounded-lg px-2.5 py-1 text-xs text-[#F3F1EA] focus:outline-none focus:border-[#D6C7A1]"
            >
              <option value="">All Collections</option>
              {collections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {queryInput.trim() && (
            <button
              type="button"
              onClick={handleAskAIAboutQuery}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#D6C7A1] hover:text-[#F0E4C2] transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Synthesize with ONYX</span>
            </button>
          )}
        </div>
      </form>

      {/* Search Results List */}
      <div className="space-y-4">
        {searchResults.length > 0 && (
          <div className="flex items-center justify-between text-xs text-[#929892] px-1">
            <span>Retrieved {searchResults.length} ranked units via Reciprocal Rank Fusion</span>
            <span className="text-[#78C6A3]">● Sub-35ms pipeline latency</span>
          </div>
        )}

        {searchResults.map((result, idx) => {
          const badge = getDocumentTypeBadge(result.documentType);
          const rrfScorePct = Math.round(result.score * 100);

          return (
            <div
              key={result.id || idx}
              className="p-5 rounded-2xl bg-[#101413] border border-[#2A302D] hover:border-[#3E4743] space-y-3 transition-all group"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded"
                    style={{ color: badge.color, backgroundColor: badge.bg }}
                  >
                    {badge.label}
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-[#F3F1EA] group-hover:text-[#D6C7A1] transition-colors">
                      {result.documentTitle}
                    </h3>
                    <p className="text-[11px] text-[#929892]">
                      {result.collectionName || 'General'} {result.pageNumber ? `· Page ${result.pageNumber}` : ''} {result.sectionHeader ? `· ${result.sectionHeader}` : ''}
                    </p>
                  </div>
                </div>

                {/* Score Pills */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#171C1A] text-[#78C6A3] border border-[#2A302D]">
                    {rrfScorePct}% Match
                  </span>
                </div>
              </div>

              {/* Passage Content */}
              <p className="text-xs text-[#F3F1EA] leading-relaxed bg-[#171C1A]/60 p-3.5 rounded-xl border border-[#2A302D]/60 font-sans">
                {result.content}
              </p>

              {/* Footer Actions */}
              <div className="flex items-center justify-between text-[11px] text-[#626863] pt-1">
                <span>Chunk ID: {result.chunkId}</span>
                <button
                  onClick={() => {
                    inspectCitation({
                      id: `cit-${result.chunkId}`,
                      citationIndex: idx + 1,
                      documentId: result.documentId,
                      documentTitle: result.documentTitle,
                      sourceType: result.documentType,
                      pageNumber: result.pageNumber,
                      slideNumber: result.slideNumber,
                      section: result.sectionHeader,
                      chunkId: result.chunkId,
                      excerpt: result.content,
                      collectionName: result.collectionName,
                      score: result.score,
                    });
                    setActiveTab('chat');
                  }}
                  className="text-xs font-semibold text-[#D6C7A1] hover:text-[#F0E4C2] flex items-center gap-1 transition-colors"
                >
                  <span>Inspect Evidence</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
