/**
 * Second Brain — Chat Message Component
 * Formats grounded responses and renders clickable inline citation chips
 */

import React from 'react';
import { Message, Citation } from '../../types';
import { CitationChip } from './CitationChip';
import { Brain, User, Sparkles } from 'lucide-react';

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === 'user';

  // Helper to parse [[01]], [[02]], [[02], [04]], [SOURCE 01] citation markers and replace with interactive CitationChip
  const renderFormattedContent = (content: string, citations?: Citation[]) => {
    if (!content) return null;

    // Normalize varying citation formats into standard [[XX]] tokens
    let normalized = content.replace(/\[SOURCE\s*(\d+)\]/gi, (_match, num) => {
      const padded = num.length === 1 ? `0${num}` : num;
      return `[[${padded}]]`;
    });

    normalized = normalized.replace(/\[\[([0-9,\s\[\]]+)\]\]/g, (match, inner) => {
      const nums = inner.match(/\d+/g);
      if (!nums || nums.length === 0) return match;
      return nums
        .map((n: string) => {
          const padded = n.length === 1 ? `0${n}` : n;
          return `[[${padded}]]`;
        })
        .join(' ');
    });

    const parts = normalized.split(/(\[\[\d+\]\])/g);

    return parts.map((part, index) => {
      const match = part.match(/\[\[(\d+)\]\]/);
      if (match) {
        const citationNum = parseInt(match[1], 10);
        const citObj = citations?.find(c => c.citationIndex === citationNum);
        return <CitationChip key={index} citationIndex={citationNum} citation={citObj} />;
      }

      // Render standard text and simple markdown formatting
      return (
        <span key={index} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    });
  };

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-2xl rounded-2xl bg-[#171C1A] border border-[#2A302D] px-5 py-3.5 text-sm text-[#F3F1EA] shadow-md">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-4 max-w-3xl">
      <div className="w-8 h-8 rounded-lg bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] flex-shrink-0 mt-1 shadow-sm">
        <Brain className="w-4 h-4" />
      </div>

      <div className="flex-1 space-y-3">
        {/* Assistant Header Badge */}
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#78C6A3]" />
          <span className="text-[11px] font-bold tracking-widest text-[#929892] uppercase">
            SECOND BRAIN
          </span>
          {message.isStreaming && (
            <span className="text-[10px] text-[#D6C7A1] animate-pulse">
              Synthesizing...
            </span>
          )}
        </div>

        {/* Content Body */}
        <div className="text-sm text-[#F3F1EA] leading-relaxed space-y-3 font-sans">
          {message.content ? (
            renderFormattedContent(message.content, message.citations)
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-[#929892]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#D6C7A1] animate-bounce" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#D6C7A1] animate-bounce [animation-delay:0.2s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#D6C7A1] animate-bounce [animation-delay:0.4s]" />
            </div>
          )}
        </div>

        {/* Citations Footer Chips */}
        {message.citations && message.citations.length > 0 && !message.isStreaming && (
          <div className="pt-2 flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-[#626863]">Sources:</span>
            {message.citations.map(cit => (
              <CitationChip key={cit.id} citationIndex={cit.citationIndex} citation={cit} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
