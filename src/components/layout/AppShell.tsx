/**
 * ONYX — App Shell Layout Component
 * Integrates Sidebar, TopBar, Toast notifications, Add Knowledge modal, Command Palette,
 * Auth conditional rendering, and Setup Wizard onboarding.
 */

import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { CommandPalette } from './CommandPalette';
import { AddKnowledgeModal } from '../upload/AddKnowledgeModal';
import { SetupWizardModal } from '../setup/SetupWizardModal';
import { AuthScreen } from '../auth/AuthScreen';
import { ToastContainer } from '../common/Toast';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { Brain } from 'lucide-react';

import { OverviewDashboard } from '../overview/OverviewDashboard';
import { KnowledgeView } from '../knowledge/KnowledgeView';
import { CollectionsView } from '../collections/CollectionsView';
import { SearchInterface } from '../search/SearchInterface';
import { ChatContainer } from '../chat/ChatContainer';
import { SettingsView } from '../settings/SettingsView';

export const AppShell: React.FC = () => {
  const { activeTab } = useUI();
  const { user, isAuthenticated, isLoading, setupStatus } = useAuth();
  const [showSetupModal, setShowSetupModal] = useState(false);

  // Auto-launch Setup Wizard if user has logged in but not completed setup
  useEffect(() => {
    if (isAuthenticated && setupStatus && !setupStatus.setupCompleted) {
      setShowSetupModal(true);
    }
  }, [isAuthenticated, setupStatus?.setupCompleted]);

  // Loading Splash Screen
  if (isLoading) {
    return (
      <div className="flex h-screen w-screen bg-[#080A0A] items-center justify-center select-none font-sans">
        <div className="flex flex-col items-center gap-4 animate-in fade-in duration-300">
          <div className="w-12 h-12 rounded-2xl bg-[#171C1A] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] shadow-lg">
            <Brain className="w-6 h-6 animate-pulse" />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 border-2 border-[#D6C7A1] border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-medium text-[#929892]">Initializing ONYX Workspace...</span>
          </div>
        </div>
      </div>
    );
  }

  // If not authenticated, display the unified AuthScreen (Login/Signup/Forgot/Reset)
  if (!isAuthenticated) {
    return (
      <>
        <AuthScreen />
        <ToastContainer />
      </>
    );
  }

  const renderActiveView = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewDashboard />;
      case 'knowledge':
        return <KnowledgeView />;
      case 'collections':
        return <CollectionsView />;
      case 'search':
        return <SearchInterface />;
      case 'chat':
        return <ChatContainer />;
      case 'settings':
        return <SettingsView />;
      default:
        return <OverviewDashboard />;
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#080A0A] text-[#F3F1EA] overflow-hidden select-none font-sans">
      {/* Persistent Left Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto bg-[#080A0A]">
          {renderActiveView()}
        </main>
      </div>

      {/* Global Modals & Overlays */}
      <CommandPalette />
      <AddKnowledgeModal />
      <SetupWizardModal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
      />
      <ToastContainer />
    </div>
  );
};
