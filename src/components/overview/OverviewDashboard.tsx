/**
 * Second Brain — Overview Dashboard Component
 * Matches Stitch visual archetype from Image 1 & 8
 */

import React, { useState, useEffect } from 'react';
import { useUI } from '../../context/UIContext';
import { useChat } from '../../context/ChatContext';
import { MetricsRow } from './MetricsRow';
import { RecentKnowledge } from './RecentKnowledge';
import { ContinueThinking } from './ContinueThinking';
import { ActivityFeed } from './ActivityFeed';
import { Plus, Brain } from 'lucide-react';

export function getGreetingForDate(date: Date = new Date()): string {
  const hours = date.getHours();
  if (hours >= 5 && hours < 12) {
    return 'Good morning.';
  }
  if (hours >= 12 && hours < 17) {
    return 'Good afternoon.';
  }
  if (hours >= 17 && hours < 22) {
    return 'Good evening.';
  }
  return 'Welcome back, thinker.';
}

export const OverviewDashboard: React.FC = () => {
  const { openAddKnowledge, setActiveTab } = useUI();
  const { startNewConversation } = useChat();
  const [greeting, setGreeting] = useState<string>(() => getGreetingForDate());

  useEffect(() => {
    // Check and update greeting every 30 seconds for automatic boundary transitions
    const updateGreeting = () => {
      setGreeting(getGreetingForDate());
    };
    const interval = setInterval(updateGreeting, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAskSecondBrain = async () => {
    await startNewConversation('New Inquiry');
    setActiveTab('chat');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-2">
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-[#D6C7A1] uppercase tracking-widest">
            YOUR KNOWLEDGE
          </div>
          <h1 className="text-3xl lg:text-4xl font-extrabold text-[#F3F1EA] tracking-tight">
            {greeting}
          </h1>
          <p className="text-sm text-[#929892]">
            Everything you know, ready when you need it.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            id="btn-overview-add-knowledge"
            onClick={openAddKnowledge}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#D6C7A1] hover:bg-[#F0E4C2] text-[#080A0A] text-xs font-bold tracking-wide transition-all shadow-md active:scale-[0.98] cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Add Knowledge</span>
          </button>

          <button
            id="btn-overview-ask-ai"
            onClick={handleAskSecondBrain}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#101413] hover:bg-[#171C1A] text-[#F3F1EA] border border-[#D6C7A1]/40 hover:border-[#D6C7A1] text-xs font-semibold tracking-wide transition-all shadow-sm active:scale-[0.98] cursor-pointer"
          >
            <Brain className="w-4 h-4 text-[#D6C7A1]" />
            <span>Ask ONYX</span>
          </button>
        </div>
      </div>

      {/* Metrics Row */}
      <MetricsRow />

      {/* Main Content: Recent Knowledge -> Continue Thinking -> Activity */}
      <div className="space-y-6">
        <RecentKnowledge />
        <ContinueThinking />
        <ActivityFeed />
      </div>
    </div>
  );
};
