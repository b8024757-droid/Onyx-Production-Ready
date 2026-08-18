/**
 * Second Brain — Command Palette Modal (⌘K)
 */

import React, { useState, useEffect } from 'react';
import { useUI } from '../../context/UIContext';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useChat } from '../../context/ChatContext';
import { Search, BookOpen, MessageSquare, Plus, ArrowRight, FolderTree, X } from 'lucide-react';
import { getDocumentTypeBadge } from '../../utils/formatters';

export const CommandPalette: React.FC = () => {
  const { isCommandPaletteOpen, closeCommandPalette, setActiveTab, openAddKnowledge } = useUI();
  const { documents, executeSearch, searchResults } = useKnowledge();
  const { startNewConversation, sendMessage } = useChat();
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (query.trim()) {
      executeSearch(query);
    }
  }, [query]);

  if (!isCommandPaletteOpen) return null;

  const handleAskAI = async () => {
    closeCommandPalette();
    await startNewConversation(query);
    setActiveTab('chat');
    sendMessage(query);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        id="command-palette-modal"
        className="w-full max-w-2xl bg-[#101413] border border-[#2A302D] rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Search Input Box */}
        <div className="flex items-center px-4 py-3.5 border-b border-[#2A302D] gap-3">
          <Search className="w-4 h-4 text-[#929892]" />
          <input
            autoFocus
            type="text"
            placeholder="Search knowledge base, run actions, or ask ONYX..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm text-[#F3F1EA] placeholder-[#626863] focus:outline-none"
            onKeyDown={e => {
              if (e.key === 'Escape') closeCommandPalette();
              if (e.key === 'Enter' && query.trim()) handleAskAI();
            }}
          />
          <button
            onClick={closeCommandPalette}
            className="p-1 text-[#929892] hover:text-[#F3F1EA] rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-1">
          {/* Ask AI Action */}
          {query.trim() && (
            <button
              onClick={handleAskAI}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-[#171C1A] hover:bg-[#1C2220] border border-[#2A302D] transition-colors text-left group"
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-[#D6C7A1]/15 text-[#D6C7A1] flex items-center justify-center">
                  <MessageSquare className="w-3.5 h-3.5" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#F3F1EA]">
                    Ask ONYX: "{query}"
                  </p>
                  <p className="text-[11px] text-[#929892]">
                    Synthesize answer grounded across all documents
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[#929892] group-hover:text-[#D6C7A1] transition-colors" />
            </button>
          )}

          {/* Quick Actions */}
          <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-[#626863] uppercase tracking-wider">
            Quick Actions
          </div>

          <button
            onClick={() => {
              closeCommandPalette();
              openAddKnowledge();
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#171C1A] text-xs text-[#929892] hover:text-[#F3F1EA] transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-[#D6C7A1]" />
            <span>Upload or import new knowledge source</span>
          </button>

          <button
            onClick={() => {
              closeCommandPalette();
              setActiveTab('knowledge');
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#171C1A] text-xs text-[#929892] hover:text-[#F3F1EA] transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#78C6A3]" />
            <span>Explore all documents library</span>
          </button>

          <button
            onClick={() => {
              closeCommandPalette();
              setActiveTab('collections');
            }}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#171C1A] text-xs text-[#929892] hover:text-[#F3F1EA] transition-colors"
          >
            <FolderTree className="w-3.5 h-3.5 text-[#FB923C]" />
            <span>Browse collections</span>
          </button>

          {/* Matching Documents */}
          {documents.length > 0 && (
            <>
              <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-[#626863] uppercase tracking-wider">
                Knowledge Documents
              </div>
              {documents.slice(0, 4).map(doc => {
                const badge = getDocumentTypeBadge(doc.type);
                return (
                  <button
                    key={doc.id}
                    onClick={() => {
                      closeCommandPalette();
                      setActiveTab('knowledge');
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[#171C1A] text-left transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ color: badge.color, backgroundColor: badge.bg }}
                      >
                        {badge.label}
                      </span>
                      <span className="text-xs text-[#F3F1EA] truncate max-w-sm">
                        {doc.title}
                      </span>
                    </div>
                    <span className="text-[10px] text-[#929892]">{doc.category}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-[#080A0A] border-t border-[#2A302D] flex items-center justify-between text-[11px] text-[#929892]">
          <span>Navigation: <kbd className="px-1 py-0.5 bg-[#171C1A] rounded border border-[#2A302D]">↑</kbd> <kbd className="px-1 py-0.5 bg-[#171C1A] rounded border border-[#2A302D]">↓</kbd></span>
          <span>Select: <kbd className="px-1 py-0.5 bg-[#171C1A] rounded border border-[#2A302D]">Enter</kbd></span>
        </div>
      </div>
    </div>
  );
};
