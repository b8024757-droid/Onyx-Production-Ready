/**
 * Second Brain — Chat & Grounded RAG Context
 * Handles conversational state, message history, SSE streaming, and Evidence Inspector
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Conversation, Message, Citation, QueryMetrics } from '../types';
import { api } from '../services/api';
import { useUI } from './UIContext';
import { useAuth } from './AuthContext';

interface ChatContextType {
  conversations: Conversation[];
  activeConversation: Conversation | null;
  messages: Message[];
  isLoadingMessages: boolean;
  isStreaming: boolean;
  activeCollectionScopeId: string | null;
  setActiveCollectionScopeId: (id: string | null) => void;
  selectConversation: (id: string) => Promise<void>;
  startNewConversation: (title?: string) => Promise<string>;
  deleteConversation: (id: string) => Promise<boolean>;
  sendMessage: (content: string) => Promise<void>;
  currentMetrics: Partial<QueryMetrics> | null;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { inspectCitation, showToast } = useUI();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeCollectionScopeId, setActiveCollectionScopeId] = useState<string | null>(null);
  const [currentMetrics, setCurrentMetrics] = useState<Partial<QueryMetrics> | null>(null);

  // Load conversations on mount or user change
  const loadConversations = useCallback(async () => {
    try {
      const res = await api.getConversations();
      setConversations(res.conversations);
      if (res.conversations.length > 0) {
        // If current active conversation doesn't exist in new list, pick first
        if (!activeConversation || !res.conversations.some(c => c.id === activeConversation.id)) {
          selectConversation(res.conversations[0].id);
        }
      } else {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  }, [activeConversation, user?.id]);

  useEffect(() => {
    loadConversations();
  }, [user?.id]);

  const selectConversation = async (id: string) => {
    setIsLoadingMessages(true);
    try {
      const res = await api.getMessages(id);
      setActiveConversation(res.conversation);
      setMessages(res.messages);
      setActiveCollectionScopeId(res.conversation.collectionScopeId || null);
    } catch (e: any) {
      showToast('error', 'Failed to load conversation', e.message);
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const startNewConversation = async (title?: string): Promise<string> => {
    try {
      const res = await api.createConversation(title, activeCollectionScopeId || undefined);
      setConversations(prev => [res.conversation, ...prev]);
      setActiveConversation(res.conversation);
      setMessages([]);
      return res.conversation.id;
    } catch (e: any) {
      showToast('error', 'Could not create new chat', e.message);
      return '';
    }
  };

  const deleteConversation = async (id: string): Promise<boolean> => {
    try {
      await api.deleteConversation(id);
      
      // Remove from conversations list immediately
      setConversations(prev => prev.filter(c => c.id !== id));
      
      // If the currently open conversation was deleted, clear active state cleanly
      if (activeConversation?.id === id) {
        setActiveConversation(null);
        setMessages([]);
        setCurrentMetrics(null);
      }

      showToast('success', 'Conversation Deleted', 'The conversation and messages were permanently removed.');
      return true;
    } catch (e: any) {
      showToast('error', 'Failed to delete conversation', e.message || 'Server error');
      return false;
    }
  };

  const sendMessage = async (userQuery: string) => {
    if (!userQuery.trim() || isStreaming) return;

    let convId = activeConversation?.id;
    if (!convId) {
      convId = await startNewConversation(userQuery.slice(0, 48));
    }

    // Optimistically append user message
    const tempUserMsg: Message = {
      id: `temp-user-${Date.now()}`,
      conversationId: convId,
      role: 'user',
      content: userQuery,
      createdAt: new Date().toISOString(),
    };

    const tempAssistantMsgId = `temp-assistant-${Date.now()}`;
    const tempAssistantMsg: Message = {
      id: tempAssistantMsgId,
      conversationId: convId,
      role: 'assistant',
      content: '',
      citations: [],
      createdAt: new Date().toISOString(),
      isStreaming: true,
    };

    setMessages(prev => [...prev, tempUserMsg, tempAssistantMsg]);
    setIsStreaming(true);

    let accumulatedText = '';
    let streamCitations: Citation[] = [];

    api.streamChat(convId, userQuery, activeCollectionScopeId || undefined, {
      onChunk: chunk => {
        accumulatedText += chunk;
        setMessages(prev =>
          prev.map(m =>
            m.id === tempAssistantMsgId
              ? { ...m, content: accumulatedText, citations: streamCitations, isStreaming: true }
              : m
          )
        );
      },
      onCitations: citations => {
        streamCitations = citations;
        setMessages(prev =>
          prev.map(m =>
            m.id === tempAssistantMsgId ? { ...m, citations } : m
          )
        );
      },
      onMetrics: metrics => {
        setCurrentMetrics(metrics);
      },
      onDone: metrics => {
        setIsStreaming(false);
        setCurrentMetrics(metrics);
        setMessages(prev =>
          prev.map(m =>
            m.id === tempAssistantMsgId
              ? { ...m, content: accumulatedText, citations: streamCitations, isStreaming: false }
              : m
          )
        );
        loadConversations();
      },
      onError: err => {
        setIsStreaming(false);
        showToast('error', 'Chat Stream Interrupted', err);
        setMessages(prev =>
          prev.map(m =>
            m.id === tempAssistantMsgId
              ? {
                  ...m,
                  content:
                    accumulatedText ||
                    'I encountered an error retrieving knowledge for your query. Please retry.',
                  isStreaming: false,
                }
              : m
          )
        );
      },
    });
  };

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeConversation,
        messages,
        isLoadingMessages,
        isStreaming,
        activeCollectionScopeId,
        setActiveCollectionScopeId,
        selectConversation,
        startNewConversation,
        deleteConversation,
        sendMessage,
        currentMetrics,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
