/**
 * Second Brain — Continue Thinking Component
 */

import React from 'react';
import { useChat } from '../../context/ChatContext';
import { useUI } from '../../context/UIContext';
import { MessageSquare, Plus, ArrowRight } from 'lucide-react';
import { formatRelativeTime } from '../../utils/formatters';

export const ContinueThinking: React.FC = () => {
  const { conversations, selectConversation, startNewConversation } = useChat();
  const { setActiveTab } = useUI();

  const handleStartNew = async () => {
    await startNewConversation('New Thought');
    setActiveTab('chat');
  };

  const handleSelectChat = async (id: string) => {
    await selectConversation(id);
    setActiveTab('chat');
  };

  return (
    <div className="rounded-2xl bg-[#101413] border border-[#2A302D] p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#F3F1EA] tracking-wide">
          Continue Thinking
        </h3>
        <button
          onClick={handleStartNew}
          className="text-xs font-semibold text-[#D6C7A1] hover:text-[#F0E4C2] flex items-center gap-1 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>
      </div>

      <div className="space-y-2.5">
        {conversations.slice(0, 3).map(conv => (
          <div
            key={conv.id}
            onClick={() => handleSelectChat(conv.id)}
            className="p-3.5 rounded-xl bg-[#171C1A] hover:bg-[#1C2220] border border-[#2A302D] hover:border-[#3E4743] flex items-start justify-between cursor-pointer transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-md bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#929892] group-hover:text-[#D6C7A1] transition-colors mt-0.5">
                <MessageSquare className="w-3 h-3" />
              </div>
              <div>
                <h4 className="text-xs font-semibold text-[#F3F1EA] group-hover:text-[#D6C7A1] transition-colors line-clamp-1">
                  {conv.title}
                </h4>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#101413] text-[#929892] border border-[#2A302D]">
                    {conv.tags?.[0] || 'Research'} · {conv.sourcesReferenced || 4} sources
                  </span>
                  <span className="text-[10px] text-[#626863]">
                    {formatRelativeTime(conv.updatedAt)}
                  </span>
                </div>
              </div>
            </div>

            <ArrowRight className="w-3.5 h-3.5 text-[#626863] group-hover:text-[#F3F1EA] transition-colors opacity-0 group-hover:opacity-100" />
          </div>
        ))}
      </div>
    </div>
  );
};
