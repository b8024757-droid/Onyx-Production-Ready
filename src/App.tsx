/**
 * Second Brain — Main React Application
 */

import React from 'react';
import { AuthProvider } from './context/AuthContext';
import { UIProvider } from './context/UIContext';
import { KnowledgeProvider } from './context/KnowledgeContext';
import { ChatProvider } from './context/ChatContext';
import { NotificationProvider } from './context/NotificationContext';
import { AppShell } from './components/layout/AppShell';

export default function App() {
  return (
    <AuthProvider>
      <UIProvider>
        <NotificationProvider>
          <KnowledgeProvider>
            <ChatProvider>
              <AppShell />
            </ChatProvider>
          </KnowledgeProvider>
        </NotificationProvider>
      </UIProvider>
    </AuthProvider>
  );
}
