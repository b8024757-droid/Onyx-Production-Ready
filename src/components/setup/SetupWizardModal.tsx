/**
 * Second Brain — Infrastructure Setup Wizard
 * Multi-step wizard to configure and verify Google Gemini API, Qdrant Vector DB, and PostgreSQL
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { api } from '../../services/api';
import {
  Brain,
  Sparkles,
  Database,
  Layers,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  X,
  RefreshCw,
  ShieldCheck,
  Zap,
  Server,
} from 'lucide-react';
import { Button } from '../common/Button';

interface SetupWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SetupWizardModal: React.FC<SetupWizardModalProps> = ({ isOpen, onClose }) => {
  const { setupStatus, refreshSetupStatus } = useAuth();
  const { showToast } = useUI();

  // Wizard Step: 1 = Gemini, 2 = Qdrant, 3 = Postgres, 4 = Ready
  const [step, setStep] = useState<number>(1);

  // Form Fields
  const [geminiKey, setGeminiKey] = useState('');
  const [qdrantUrl, setQdrantUrl] = useState('');
  const [qdrantApiKey, setQdrantApiKey] = useState('');
  const [postgresUrl, setPostgresUrl] = useState('');

  // Statuses
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Connection Test Results
  const [testStatus, setTestStatus] = useState<{
    target: string;
    loading: boolean;
    connected?: boolean;
    latencyMs?: number;
    message?: string;
  } | null>(null);

  useEffect(() => {
    if (setupStatus) {
      if (setupStatus.currentSetupStep === 'gemini') setStep(1);
      else if (setupStatus.currentSetupStep === 'qdrant') setStep(2);
      else if (setupStatus.currentSetupStep === 'postgres') setStep(3);
      else if (setupStatus.currentSetupStep === 'ready' || setupStatus.setupCompleted) setStep(4);
    }
  }, [setupStatus]);

  if (!isOpen) return null;

  const resetStatus = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setTestStatus(null);
  };

  // 1. Submit Gemini
  const handleSaveGemini = async (skip: boolean = false) => {
    resetStatus();
    setIsLoading(true);
    try {
      if (skip) {
        await api.setupGemini({ skip: true });
        showToast('info', 'Gemini Setup Skipped', 'Using default environment fallback.');
      } else {
        if (!geminiKey.trim()) {
          setErrorMsg('Please enter a valid Gemini API Key.');
          setIsLoading(false);
          return;
        }
        await api.setupGemini({ apiKey: geminiKey.trim() });
        showToast('success', 'Gemini Connected', 'API key verified and encrypted via AES-256.');
      }
      await refreshSetupStatus();
      setStep(2);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to verify Gemini API Key.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Submit Qdrant
  const handleSaveQdrant = async (skip: boolean = false) => {
    resetStatus();
    setIsLoading(true);
    try {
      if (skip) {
        await api.setupQdrant({ skip: true });
        showToast('info', 'Qdrant Setup Skipped', 'In-memory vector store will be used.');
      } else {
        if (!qdrantUrl.trim()) {
          setErrorMsg('Please enter a valid Qdrant cluster URL.');
          setIsLoading(false);
          return;
        }
        await api.setupQdrant({
          url: qdrantUrl.trim(),
          apiKey: qdrantApiKey.trim() || undefined,
        });
        showToast('success', 'Qdrant Cluster Connected', 'Vector cluster verified.');
      }
      await refreshSetupStatus();
      setStep(3);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to connect to Qdrant cluster.');
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Submit Postgres
  const handleSavePostgres = async (skip: boolean = false) => {
    resetStatus();
    setIsLoading(true);
    try {
      if (skip) {
        await api.setupPostgres({ skip: true });
        showToast('info', 'PostgreSQL Setup Skipped', 'Snapshot memory storage mode active.');
      } else {
        if (!postgresUrl.trim()) {
          setErrorMsg('Please enter a valid PostgreSQL connection string.');
          setIsLoading(false);
          return;
        }
        await api.setupPostgres({ connectionUrl: postgresUrl.trim() });
        showToast('success', 'PostgreSQL Connected', 'Relational database connected.');
      }
      await refreshSetupStatus();
      setStep(4);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to connect to PostgreSQL database.');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Complete Setup
  const handleCompleteSetup = async () => {
    resetStatus();
    setIsLoading(true);
    try {
      await api.completeSetup();
      await refreshSetupStatus();
      showToast('success', 'Setup Complete', 'Your ONYX workspace is fully operational.');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete setup.');
    } finally {
      setIsLoading(false);
    }
  };

  // Test individual connection live
  const handleTestConnection = async (target: 'gemini' | 'qdrant' | 'postgres') => {
    setTestStatus({ target, loading: true });
    try {
      const res = await api.testConnection(target);
      setTestStatus({
        target,
        loading: false,
        connected: res.connected,
        latencyMs: res.latencyMs,
        message: res.message,
      });
      if (res.connected) {
        showToast('success', `${target.toUpperCase()} Healthy`, `Latency: ${res.latencyMs}ms`);
      } else {
        showToast('error', `${target.toUpperCase()} Unreachable`, res.message);
      }
    } catch (err: any) {
      setTestStatus({
        target,
        loading: false,
        connected: false,
        message: err.message,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#080A0A]/85 backdrop-blur-md animate-in fade-in duration-200 select-none font-sans">
      <div className="w-full max-w-2xl rounded-2xl bg-[#101413] border border-[#2A302D] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-[#2A302D] flex items-center justify-between bg-[#171C1A]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1]">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[#F3F1EA] tracking-wide uppercase">
                ONYX Infrastructure Wizard
              </h2>
              <p className="text-xs text-[#929892]">
                Configure personalized AI engines, vector database, and storage
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#101413] text-[#929892] hover:text-[#F3F1EA] flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step Progress Pills */}
        <div className="grid grid-cols-4 border-b border-[#2A302D] bg-[#0C0F0E] text-xs font-semibold">
          {[
            { num: 1, label: 'Gemini AI', icon: <Sparkles className="w-3.5 h-3.5" /> },
            { num: 2, label: 'Qdrant Vectors', icon: <Layers className="w-3.5 h-3.5" /> },
            { num: 3, label: 'PostgreSQL DB', icon: <Database className="w-3.5 h-3.5" /> },
            { num: 4, label: 'Launch', icon: <Zap className="w-3.5 h-3.5" /> },
          ].map((s) => {
            const isActive = step === s.num;
            const isCompleted = step > s.num;
            return (
              <button
                key={s.num}
                onClick={() => setStep(s.num)}
                className={`py-3 px-2 flex items-center justify-center gap-2 border-r last:border-r-0 border-[#2A302D] transition-colors ${
                  isActive
                    ? 'bg-[#171C1A] text-[#D6C7A1] border-b-2 border-b-[#D6C7A1]'
                    : isCompleted
                    ? 'text-[#78C6A3] bg-[#101413]'
                    : 'text-[#626863] bg-[#0C0F0E]'
                }`}
              >
                {isCompleted ? <CheckCircle2 className="w-3.5 h-3.5 text-[#78C6A3]" /> : s.icon}
                <span className="truncate">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-[#101413]">
          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div className="p-3.5 rounded-xl bg-[#78C6A3]/10 border border-[#78C6A3]/30 flex items-start gap-3 text-xs text-[#78C6A3]">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{successMsg}</div>
            </div>
          )}

          {/* STEP 1: GEMINI */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-[#D6C7A1] mt-0.5 flex-shrink-0" />
                <div className="text-xs text-[#929892] space-y-1">
                  <p className="font-semibold text-[#F3F1EA]">Google Gemini AI (Bring Your Own Key)</p>
                  <p>
                    Powers hybrid RAG grounding, document chunk embeddings, and high-speed multi-modal ingestion.
                    Keys are AES-256 encrypted and isolated to your user account.
                  </p>
                </div>
              </div>

              {setupStatus?.geminiConnected && (
                <div className="p-3 rounded-xl bg-[#78C6A3]/10 border border-[#78C6A3]/30 flex items-center justify-between text-xs text-[#78C6A3]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Gemini API Key is currently verified & active ({setupStatus.geminiMasked})</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={testStatus?.loading && testStatus.target === 'gemini'}
                    onClick={() => handleTestConnection('gemini')}
                  >
                    Test Live
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  {setupStatus?.geminiConnected ? 'Update Gemini API Key' : 'Gemini API Key'}
                </label>
                <input
                  id="input-setup-gemini-key"
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none font-mono"
                />
              </div>

              <div className="pt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => handleSaveGemini(true)}
                  className="text-xs text-[#929892] hover:text-[#F3F1EA] underline font-medium"
                >
                  Skip for now (use default)
                </button>
                <Button
                  id="btn-save-gemini"
                  variant="champagne"
                  size="md"
                  loading={isLoading}
                  onClick={() => handleSaveGemini(false)}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Verify & Proceed
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: QDRANT */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] flex items-start gap-3">
                <Layers className="w-5 h-5 text-[#D6C7A1] mt-0.5 flex-shrink-0" />
                <div className="text-xs text-[#929892] space-y-1">
                  <p className="font-semibold text-[#F3F1EA]">Qdrant Vector Cluster (Optional Cloud Cluster)</p>
                  <p>
                    Enables high-scale approximate nearest neighbor vector indexing. If skipped, ONYX runs
                    an integrated vector memory engine automatically.
                  </p>
                </div>
              </div>

              {setupStatus?.qdrantConnected && (
                <div className="p-3 rounded-xl bg-[#78C6A3]/10 border border-[#78C6A3]/30 flex items-center justify-between text-xs text-[#78C6A3]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Qdrant is currently verified & active ({setupStatus.qdrantUrlMasked})</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={testStatus?.loading && testStatus.target === 'qdrant'}
                    onClick={() => handleTestConnection('qdrant')}
                  >
                    Test Live
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Qdrant Cluster URL
                </label>
                <input
                  id="input-setup-qdrant-url"
                  type="text"
                  value={qdrantUrl}
                  onChange={(e) => setQdrantUrl(e.target.value)}
                  placeholder="https://xyz-cluster.cloud.qdrant.io:6333"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none font-mono"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Qdrant API Key (if cloud protected)
                </label>
                <input
                  id="input-setup-qdrant-key"
                  type="password"
                  value={qdrantApiKey}
                  onChange={(e) => setQdrantApiKey(e.target.value)}
                  placeholder="Optional cluster token"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none font-mono"
                />
              </div>

              <div className="pt-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)} icon={<ArrowLeft className="w-3.5 h-3.5" />}>
                    Back
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleSaveQdrant(true)}
                    className="text-xs text-[#929892] hover:text-[#F3F1EA] underline font-medium"
                  >
                    Skip Qdrant (use local memory)
                  </button>
                </div>
                <Button
                  id="btn-save-qdrant"
                  variant="champagne"
                  size="md"
                  loading={isLoading}
                  onClick={() => handleSaveQdrant(false)}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Verify & Proceed
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: POSTGRES */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] flex items-start gap-3">
                <Database className="w-5 h-5 text-[#D6C7A1] mt-0.5 flex-shrink-0" />
                <div className="text-xs text-[#929892] space-y-1">
                  <p className="font-semibold text-[#F3F1EA]">PostgreSQL Relational Storage (Optional Database)</p>
                  <p>
                    Provides enterprise relational storage for documents, chunks, and metadata. If skipped, ONYX
                    saves persistent snapshots automatically.
                  </p>
                </div>
              </div>

              {setupStatus?.postgresConnected && (
                <div className="p-3 rounded-xl bg-[#78C6A3]/10 border border-[#78C6A3]/30 flex items-center justify-between text-xs text-[#78C6A3]">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>PostgreSQL is currently verified & active ({setupStatus.postgresUrlMasked})</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    loading={testStatus?.loading && testStatus.target === 'postgres'}
                    onClick={() => handleTestConnection('postgres')}
                  >
                    Test Live
                  </Button>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  PostgreSQL Connection String
                </label>
                <input
                  id="input-setup-postgres-url"
                  type="password"
                  value={postgresUrl}
                  onChange={(e) => setPostgresUrl(e.target.value)}
                  placeholder="postgresql://user:password@host:5432/onyx?sslmode=require"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none font-mono"
                />
              </div>

              <div className="pt-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => setStep(2)} icon={<ArrowLeft className="w-3.5 h-3.5" />}>
                    Back
                  </Button>
                  <button
                    type="button"
                    onClick={() => handleSavePostgres(true)}
                    className="text-xs text-[#929892] hover:text-[#F3F1EA] underline font-medium"
                  >
                    Skip PostgreSQL (use snapshot store)
                  </button>
                </div>
                <Button
                  id="btn-save-postgres"
                  variant="champagne"
                  size="md"
                  loading={isLoading}
                  onClick={() => handleSavePostgres(false)}
                  icon={<ArrowRight className="w-4 h-4" />}
                >
                  Verify & Proceed
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: LAUNCH & SUMMARY */}
          {step === 4 && (
            <div className="space-y-5 animate-in fade-in duration-150">
              <div className="text-center py-2">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#78C6A3]/10 border border-[#78C6A3]/30 text-[#78C6A3] mb-3">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-[#F3F1EA]">Workspace Infrastructure Ready</h3>
                <p className="text-xs text-[#929892] mt-1">
                  All components configured. Your ONYX intelligence pipeline is primed for ingestion & search.
                </p>
              </div>

              {/* Status Checklist */}
              <div className="rounded-xl bg-[#171C1A] border border-[#2A302D] divide-y divide-[#2A302D] text-xs">
                <div className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Sparkles className="w-4 h-4 text-[#D6C7A1]" />
                    <span className="text-[#F3F1EA] font-medium">Google Gemini LLM Engine</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-[#101413] text-[#78C6A3] border border-[#2A302D] font-mono text-[11px]">
                    {setupStatus?.geminiConnected ? 'Custom Key Verified' : 'Standard Fallback Active'}
                  </span>
                </div>

                <div className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Layers className="w-4 h-4 text-[#D6C7A1]" />
                    <span className="text-[#F3F1EA] font-medium">Vector Index Engine</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-[#101413] text-[#78C6A3] border border-[#2A302D] font-mono text-[11px]">
                    {setupStatus?.qdrantConnected ? 'Remote Qdrant Cluster' : 'Integrated Vector Store'}
                  </span>
                </div>

                <div className="p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Database className="w-4 h-4 text-[#D6C7A1]" />
                    <span className="text-[#F3F1EA] font-medium">Data Storage Engine</span>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-[#101413] text-[#78C6A3] border border-[#2A302D] font-mono text-[11px]">
                    {setupStatus?.postgresConnected ? 'PostgreSQL Relational' : 'Snapshot Storage'}
                  </span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={() => setStep(3)} icon={<ArrowLeft className="w-3.5 h-3.5" />}>
                  Review Config
                </Button>
                <Button
                  id="btn-complete-setup-wizard"
                  variant="champagne"
                  size="md"
                  loading={isLoading}
                  onClick={handleCompleteSetup}
                  icon={<Zap className="w-4 h-4" />}
                >
                  Launch ONYX
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-[#171C1A] border-t border-[#2A302D] flex items-center justify-between text-xs text-[#929892]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#78C6A3]" />
            <span>End-to-End Encrypted</span>
          </div>
          <span>Step {step} of 4</span>
        </div>
      </div>
    </div>
  );
};
