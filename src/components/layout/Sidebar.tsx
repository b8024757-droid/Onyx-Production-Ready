/**
 * Second Brain — Sidebar Navigation Component
 * Obsidian styled persistent sidebar with Stitch branding
 */

import React from 'react';
import { useUI, ActiveTab } from '../../context/UIContext';
import { useChat } from '../../context/ChatContext';
import {
  LayoutGrid,
  BookOpen,
  FolderTree,
  Search,
  MessageSquare,
  Plus,
  Settings,
  HelpCircle,
  Brain,
  Sparkles,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, openAddKnowledge } = useUI();
  const { startNewConversation } = useChat();

  const navItems: { tab: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { tab: 'overview', label: 'Overview', icon: <LayoutGrid className="w-4 h-4" /> },
    { tab: 'knowledge', label: 'Knowledge', icon: <BookOpen className="w-4 h-4" /> },
    { tab: 'collections', label: 'Collections', icon: <FolderTree className="w-4 h-4" /> },
    { tab: 'search', label: 'Search', icon: <Search className="w-4 h-4" /> },
    { tab: 'chat', label: 'Chat', icon: <MessageSquare className="w-4 h-4" /> },
  ];

  const handleCaptureThought = async () => {
    await startNewConversation('New Thought');
    setActiveTab('chat');
  };

  return (
    <aside
      id="app-sidebar"
      className="w-64 flex-shrink-0 h-screen bg-[#080A0A] border-r border-[#2A302D] flex flex-col justify-between select-none z-30"
    >
      {/* Brand Header */}
      <div className="p-5 pb-3">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="w-8 h-8 rounded-lg bg-[#171C1A] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] shadow-sm">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-xs font-bold tracking-widest text-[#F3F1EA] uppercase">
              ONYX
            </h1>
            <p className="text-[10px] text-[#929892] tracking-wider uppercase">
              PRIVATE INTELLIGENCE OS
            </p>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="mt-7 space-y-1">
          {navItems.map(item => {
            const isActive = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                id={`nav-${item.tab}`}
                onClick={() => setActiveTab(item.tab)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-[#171C1A] text-[#F3F1EA] border border-[#2A302D] shadow-sm'
                    : 'text-[#929892] hover:text-[#F3F1EA] hover:bg-[#101413]'
                }`}
              >
                <span className={isActive ? 'text-[#D6C7A1]' : 'text-[#929892]'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Action Area & Footer */}
      <div className="p-5 pt-0 space-y-4">
        {/* Quick Capture Button */}
        <button
          id="btn-capture-thought"
          onClick={handleCaptureThought}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#101413] hover:bg-[#171C1A] text-[#D6C7A1] border border-[#D6C7A1]/30 hover:border-[#D6C7A1] text-xs font-semibold tracking-wide transition-all shadow-sm active:scale-[0.98]"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Capture Thought</span>
        </button>

        {/* Footer Navigation */}
        <div className="border-t border-[#2A302D] pt-3 space-y-1">
          <button
            id="nav-settings"
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'settings'
                ? 'bg-[#171C1A] text-[#F3F1EA]'
                : 'text-[#929892] hover:text-[#F3F1EA] hover:bg-[#101413]'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </button>

          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-[#929892] hover:text-[#F3F1EA] hover:bg-[#101413] transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Support & Docs</span>
          </a>
        </div>
      </div>
    </aside>
  );
};
