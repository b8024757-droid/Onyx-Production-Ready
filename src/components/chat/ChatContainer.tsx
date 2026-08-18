/**
 * Second Brain — Chat Container Component
 * Grounded conversational interface with integrated Evidence Inspector
 */

import React, { useEffect, useRef, useState } from 'react';
import { useChat } from '../../context/ChatContext';
import { useUI } from '../../context/UIContext';
import { ChatMessage } from './ChatMessage';
import { ChatComposer } from './ChatComposer';
import { EvidenceInspector } from './EvidenceInspector';
import { MessageSquare, Plus, Brain, Sparkles, Layers, Trash2, Loader2 } from 'lucide-react';
import { Button } from '../common/Button';
import { Conversation } from '../../types';

export const ChatContainer: React.FC = () => {
  const {
    conversations,
    activeConversation,
    messages,
    isLoadingMessages,
    selectConversation,
    startNewConversation,
    deleteConversation,
    currentMetrics,
  } = useChat();
  const { activeEvidenceCitation } = useUI();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle ESC key to dismiss delete modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && conversationToDelete && !isDeleting) {
        setConversationToDelete(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [conversationToDelete, isDeleting]);

  const handleNewChat = async () => {
    await startNewConversation('New Thought');
  };

  const handleConfirmDelete = async () => {
    if (!conversationToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteConversation(conversationToDelete.id);
      setConversationToDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* Left Chat Threads Sidebar */}
      <div className="w-64 border-r border-[#2A302D] bg-[#080A0A] hidden md:flex flex-col justify-between p-4 flex-shrink-0">
        <div className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs text-[#D6C7A1]"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={handleNewChat}
          >
            New Conversation
          </Button>

          <div className="text-[10px] font-bold text-[#626863] uppercase tracking-wider px-2 pt-2">
            Recent Inquiries
          </div>

          <div className="space-y-1 overflow-y-auto max-h-[calc(100vh-14rem)]">
            {conversations.map(conv => {
              const isActive = activeConversation?.id === conv.id;
              return (
                <div
                  key={conv.id}
                  onClick={() => selectConversation(conv.id)}
                  className={`group relative w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-center justify-between gap-2 cursor-pointer ${
                    isActive
                      ? 'bg-[#171C1A] text-[#F3F1EA] border border-[#2A302D]'
                      : 'text-[#929892] hover:text-[#F3F1EA] hover:bg-[#101413] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <MessageSquare className="w-3.5 h-3.5 text-[#D6C7A1] flex-shrink-0" />
                    <span className="truncate font-medium">{conv.title}</span>
                  </div>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      setConversationToDelete(conv);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-[#626863] hover:text-red-400 hover:bg-[#2A302D]/60 p-1 rounded-md transition-all flex-shrink-0"
                    title="Delete conversation"
                    aria-label={`Delete conversation ${conv.title}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {currentMetrics && (
          <div className="p-3 rounded-xl bg-[#101413] border border-[#2A302D] text-[10px] text-[#929892] space-y-1">
            <div className="flex justify-between">
              <span>Retrieval:</span>
              <span className="text-[#78C6A3] font-mono">{currentMetrics.retrievalLatencyMs || 22}ms</span>
            </div>
            <div className="flex justify-between">
              <span>Passages Grounded:</span>
              <span className="text-[#D6C7A1] font-mono">{currentMetrics.rerankedUnitsCount || 4} units</span>
            </div>
          </div>
        )}
      </div>

      {/* Center Chat Viewport */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden bg-[#080A0A]">
        {/* Messages List */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 py-16">
              <div className="w-12 h-12 rounded-2xl bg-[#171C1A] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] shadow-xl">
                <Brain className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#F3F1EA]">
                  ONYX Ready
                </h3>
                <p className="text-xs text-[#929892] mt-1 leading-relaxed">
                  Ask synthesis questions, request summaries, or query technical details across your uploaded knowledge library.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2 w-full pt-2">
                {[
                  'What are the core mechanisms in RAG architecture?',
                  'Summarize key operational priorities for Q3',
                  'Explain the differences between dense and sparse retrieval',
                ].map((sample, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const composer = document.querySelector('textarea');
                      if (composer) {
                        composer.value = sample;
                        composer.focus();
                      }
                    }}
                    className="p-2.5 text-xs text-left rounded-xl bg-[#101413] hover:bg-[#171C1A] border border-[#2A302D] text-[#929892] hover:text-[#F3F1EA] transition-colors"
                  >
                    "{sample}"
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(msg => <ChatMessage key={msg.id} message={msg} />)
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Composer */}
        <ChatComposer />
      </div>

      {/* Evidence Inspector Side Panel */}
      <EvidenceInspector />

      {/* Delete Confirmation Modal */}
      {conversationToDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => {
            if (!isDeleting) setConversationToDelete(null);
          }}
        >
          <div
            id="delete-conversation-modal"
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md bg-[#101413] border border-[#2A302D] rounded-2xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 flex-shrink-0 mt-0.5">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0 flex-1">
                <h3 className="text-base font-bold text-[#F3F1EA]">
                  Delete conversation?
                </h3>
                <p className="text-xs text-[#929892] leading-relaxed">
                  This conversation and its messages will be permanently deleted.
                </p>
                <div className="mt-2 p-2.5 rounded-lg bg-[#171C1A] border border-[#2A302D] text-xs text-[#F3F1EA] font-medium truncate">
                  "{conversationToDelete.title}"
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#2A302D]">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConversationToDelete(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#929892] hover:text-[#F3F1EA] hover:bg-[#171C1A] transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold tracking-wide transition-all shadow-md flex items-center gap-2 cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
