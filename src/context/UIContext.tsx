/**
 * Second Brain — UI Context
 * Handles active route/navigation, modals, command palette, and Evidence Inspector inspection state
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { Citation } from '../types';

export type ActiveTab = 'overview' | 'knowledge' | 'collections' | 'search' | 'chat' | 'settings';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'error';
  title: string;
  description?: string;
}

interface UIContextType {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isAddKnowledgeOpen: boolean;
  openAddKnowledge: () => void;
  closeAddKnowledge: () => void;
  isCommandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  activeEvidenceCitation: Citation | null;
  inspectCitation: (citation: Citation | null) => void;
  toasts: ToastMessage[];
  showToast: (type: 'success' | 'info' | 'error', title: string, description?: string) => void;
  dismissToast: (id: string) => void;
}

const UIContext = createContext<UIContextType | undefined>(undefined);

export const UIProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [isAddKnowledgeOpen, setIsAddKnowledgeOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [activeEvidenceCitation, setActiveEvidenceCitation] = useState<Citation | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Listen for ⌘K / Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openAddKnowledge = () => setIsAddKnowledgeOpen(true);
  const closeAddKnowledge = () => setIsAddKnowledgeOpen(false);

  const openCommandPalette = () => setIsCommandPaletteOpen(true);
  const closeCommandPalette = () => setIsCommandPaletteOpen(false);

  const inspectCitation = (citation: Citation | null) => {
    setActiveEvidenceCitation(citation);
  };

  const showToast = (type: 'success' | 'info' | 'error', title: string, description?: string) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts(prev => [...prev, { id, type, title, description }]);
    setTimeout(() => {
      dismissToast(id);
    }, 4000);
  };

  const dismissToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <UIContext.Provider
      value={{
        activeTab,
        setActiveTab,
        isAddKnowledgeOpen,
        openAddKnowledge,
        closeAddKnowledge,
        isCommandPaletteOpen,
        openCommandPalette,
        closeCommandPalette,
        activeEvidenceCitation,
        inspectCitation,
        toasts,
        showToast,
        dismissToast,
      }}
    >
      {children}
    </UIContext.Provider>
  );
};

export const useUI = () => {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error('useUI must be used within a UIProvider');
  }
  return context;
};
