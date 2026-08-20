/**
 * Second Brain — Knowledge Context
 * Manages documents, collections, stats, search, and upload orchestration
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  Document,
  Collection,
  DocumentCategory,
  SecondBrainStats,
  SearchResult,
  Citation,
  ProcessingJob,
} from '../types';
import { api } from '../services/api';
import { useUI } from './UIContext';
import { useNotifications } from './NotificationContext';
import { useAuth } from './AuthContext';

interface KnowledgeContextType {
  documents: Document[];
  collections: Collection[];
  stats: SecondBrainStats | null;
  systemStatus: Record<string, string>;
  selectedCategory: DocumentCategory;
  setSelectedCategory: (category: DocumentCategory) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  isLoading: boolean;
  activeJobs: ProcessingJob[];
  searchResults: SearchResult[];
  searchCitations: Citation[];
  isSearching: boolean;
  refreshData: () => Promise<void>;
  uploadKnowledge: (payload: {
    name: string;
    content?: string;
    file?: File | Blob;
    type: string;
    sizeBytes: number;
    sourceUrl?: string;
    collectionId?: string;
    tags?: string[];
  }) => Promise<string>;
  deleteDocument: (id: string) => Promise<void>;
  createCollection: (name: string, description?: string, tags?: string[]) => Promise<void>;
  executeSearch: (query: string, collectionId?: string) => Promise<void>;
}

const KnowledgeContext = createContext<KnowledgeContextType | undefined>(undefined);

export const KnowledgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useUI();
  const { refreshNotifications } = useNotifications();
  const { user } = useAuth();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [stats, setStats] = useState<SecondBrainStats | null>(null);
  const [systemStatus, setSystemStatus] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<DocumentCategory>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [activeJobs, setActiveJobs] = useState<ProcessingJob[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchCitations, setSearchCitations] = useState<Citation[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const [docsRes, colsRes, statsRes] = await Promise.all([
        api.getDocuments(selectedCategory, searchQuery),
        api.getCollections(),
        api.getStats(),
      ]);
      setDocuments(docsRes.documents);
      setCollections(colsRes.collections);
      setStats(statsRes.stats);
      setSystemStatus(statsRes.systemStatus);
    } catch (err) {
      console.error('Failed to load knowledge assets:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedCategory, searchQuery, user?.id]);

  useEffect(() => {
    refreshData();
  }, [refreshData, user?.id]);

  // Poll for active background jobs
  useEffect(() => {
    if (activeJobs.length === 0) return;

    const interval = setInterval(async () => {
      try {
        const { jobs } = await api.getJobs();
        const active = jobs.filter(j => j.status !== 'READY' && j.status !== 'FAILED');
        setActiveJobs(active);

        // Check if any job just completed
        const newlyCompleted = jobs.filter(
          j => j.status === 'READY' && activeJobs.some(aj => aj.id === j.id && aj.status !== 'READY')
        );
        if (newlyCompleted.length > 0) {
          refreshData();
          refreshNotifications();
          showToast('success', 'Document Indexed', `${newlyCompleted[0].fileName} is now ready.`);
        }
      } catch (e) {
        console.error('Failed to poll jobs:', e);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [activeJobs, refreshData, refreshNotifications, showToast]);

  const uploadKnowledge = async (payload: {
    name: string;
    content?: string;
    file?: File | Blob;
    type: string;
    sizeBytes: number;
    sourceUrl?: string;
    collectionId?: string;
    tags?: string[];
  }): Promise<string> => {
    let res: { jobId: string; documentId: string };
    if (payload.file) {
      res = await api.uploadFileChunked(payload.file, payload.name, {
        collectionId: payload.collectionId,
        tags: payload.tags,
      });
    } else {
      res = await api.uploadDocument({
        name: payload.name,
        content: payload.content || '',
        type: payload.type,
        sizeBytes: payload.sizeBytes,
        sourceUrl: payload.sourceUrl,
        collectionId: payload.collectionId,
        tags: payload.tags,
      });
    }

    // Add temporary active job tracker
    const tempJob: ProcessingJob = {
      id: res.jobId,
      documentId: res.documentId,
      fileName: payload.name,
      fileType: payload.type as any,
      fileSizeBytes: payload.sizeBytes,
      status: 'PARSING',
      progress: 25,
      stepMessage: 'Parsing content and validating metadata...',
      startedAt: new Date().toISOString(),
    };
    setActiveJobs(prev => [tempJob, ...prev]);
    showToast('info', 'Ingestion Pipeline Started', `Processing ${payload.name}`);
    return res.jobId;
  };

  const deleteDocument = async (id: string) => {
    try {
      await api.deleteDocument(id);
      setDocuments(prev => prev.filter(d => d.id !== id));
      showToast('success', 'Document Deleted', 'Removed from knowledge base and indices.');
      refreshData();
    } catch (e: any) {
      showToast('error', 'Delete Failed', e.message);
    }
  };

  const createCollection = async (name: string, description?: string, tags?: string[]) => {
    try {
      const res = await api.createCollection({ name, description, tags });
      setCollections(prev => [res.collection, ...prev]);
      showToast('success', 'Collection Created', `Created collection "${name}"`);
      refreshData();
      refreshNotifications();
    } catch (e: any) {
      showToast('error', 'Create Collection Failed', e.message);
    }
  };

  const executeSearch = async (query: string, collectionId?: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearchCitations([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await api.search({ query, collectionId });
      setSearchResults(res.results);
      setSearchCitations(res.citations);
    } catch (e: any) {
      showToast('error', 'Search Error', e.message);
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <KnowledgeContext.Provider
      value={{
        documents,
        collections,
        stats,
        systemStatus,
        selectedCategory,
        setSelectedCategory,
        searchQuery,
        setSearchQuery,
        isLoading,
        activeJobs,
        searchResults,
        searchCitations,
        isSearching,
        refreshData,
        uploadKnowledge,
        deleteDocument,
        createCollection,
        executeSearch,
      }}
    >
      {children}
    </KnowledgeContext.Provider>
  );
};

export const useKnowledge = () => {
  const context = useContext(KnowledgeContext);
  if (!context) {
    throw new Error('useKnowledge must be used within a KnowledgeProvider');
  }
  return context;
};
