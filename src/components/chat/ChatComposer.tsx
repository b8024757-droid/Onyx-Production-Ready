/**
 * Second Brain — Chat Composer Component
 * Bottom chat input with collection scope selector, attachment trigger, and send button
 */

import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../../context/ChatContext';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useUI } from '../../context/UIContext';
import { Paperclip, ArrowUp, Folder, Sparkles, ChevronDown } from 'lucide-react';

export const ChatComposer: React.FC = () => {
  const { sendMessage, isStreaming, activeCollectionScopeId, setActiveCollectionScopeId } = useChat();
  const { collections } = useKnowledge();
  const { openAddKnowledge } = useUI();
  const [input, setInput] = useState('');
  const [isScopeDropdownOpen, setIsScopeDropdownOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeCollection = collections.find(c => c.id === activeCollectionScopeId);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-4 border-t border-[#2A302D] bg-[#080A0A]/90 backdrop-blur-md">
      <div className="max-w-4xl mx-auto space-y-2">
        {/* Composer Card */}
        <div className="bg-[#101413] border border-[#2A302D] focus-within:border-[#D6C7A1] rounded-2xl p-3 shadow-xl transition-all">
          <textarea
            ref={textareaRef}
            rows={2}
            placeholder="Ask ONYX anything..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-sm text-[#F3F1EA] placeholder-[#626863] resize-none focus:outline-none px-2 py-1 leading-relaxed"
          />

          {/* Controls Bar */}
          <div className="flex items-center justify-between pt-2 px-1">
            <div className="flex items-center gap-2">
              {/* Attachment Trigger */}
              <button
                type="button"
                onClick={openAddKnowledge}
                className="p-2 text-[#929892] hover:text-[#F3F1EA] hover:bg-[#171C1A] rounded-lg transition-colors"
                title="Add Knowledge Source"
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* Scope Selector Pill */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsScopeDropdownOpen(prev => !prev)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#171C1A] hover:bg-[#1C2220] border border-[#2A302D] text-xs font-semibold text-[#F3F1EA] transition-colors"
                >
                  <Folder className="w-3.5 h-3.5 text-[#D6C7A1]" />
                  <span>{activeCollection ? activeCollection.name : 'All Knowledge'}</span>
                  <ChevronDown className="w-3 h-3 text-[#929892]" />
                </button>

                {isScopeDropdownOpen && (
                  <div className="absolute bottom-full mb-2 left-0 w-56 bg-[#171C1A] border border-[#2A302D] rounded-xl shadow-2xl p-1 z-30 space-y-0.5">
                    <button
                      onClick={() => {
                        setActiveCollectionScopeId(null);
                        setIsScopeDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                        activeCollectionScopeId === null
                          ? 'bg-[#101413] text-[#D6C7A1] font-semibold'
                          : 'text-[#929892] hover:text-[#F3F1EA] hover:bg-[#101413]'
                      }`}
                    >
                      <span>All Knowledge</span>
                    </button>

                    {collections.map(c => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setActiveCollectionScopeId(c.id);
                          setIsScopeDropdownOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center justify-between ${
                          activeCollectionScopeId === c.id
                            ? 'bg-[#101413] text-[#D6C7A1] font-semibold'
                            : 'text-[#929892] hover:text-[#F3F1EA] hover:bg-[#101413]'
                        }`}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="text-[10px] text-[#626863]">{c.documentCount}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Send Button */}
            <button
              onClick={() => handleSubmit()}
              disabled={!input.trim() || isStreaming}
              className="w-8 h-8 rounded-lg bg-[#D6C7A1] hover:bg-[#F0E4C2] disabled:opacity-30 disabled:hover:bg-[#D6C7A1] text-[#080A0A] flex items-center justify-center transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-[11px] text-[#626863] text-center">
          ONYX grounds answers strictly on your documents. Verify important citations in the inspector.
        </p>
      </div>
    </div>
  );
};
