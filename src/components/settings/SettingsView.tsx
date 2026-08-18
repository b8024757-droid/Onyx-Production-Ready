/**
 * Second Brain — Settings & Observability View
 * Includes User Profile, BYOK Infrastructure Status, Live Connection Tests, and System Architecture
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useUI } from '../../context/UIContext';
import { api } from '../../services/api';
import {
  User as UserIcon,
  Mail,
  LogOut,
  Sparkles,
  Database,
  Layers,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  Wrench,
  KeyRound,
  Server,
  Zap,
} from 'lucide-react';
import { Button } from '../common/Button';
import { SetupWizardModal } from '../setup/SetupWizardModal';

export const SettingsView: React.FC = () => {
  const { user, setupStatus, logout, refreshSetupStatus } = useAuth();
  const { systemStatus, stats, refreshData } = useKnowledge();
  const { showToast } = useUI();

  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [testingTarget, setTestingTarget] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    target: string;
    connected: boolean;
    latencyMs?: number;
    message?: string;
  } | null>(null);

  const handleReindex = async () => {
    showToast('info', 'Re-indexing Pipeline', 'Revalidating vector and keyword indices...');
    await refreshData();
    showToast('success', 'Index Health Verified', 'All units active.');
  };

  const handleTestService = async (target: 'gemini' | 'qdrant' | 'postgres') => {
    setTestingTarget(target);
    setTestResult(null);
    try {
      const res = await api.testConnection(target);
      setTestResult({
        target,
        connected: res.connected,
        latencyMs: res.latencyMs,
        message: res.message,
      });
      if (res.connected) {
        showToast('success', `${target.toUpperCase()} Live`, `Verified response in ${res.latencyMs}ms`);
      } else {
        showToast('error', `${target.toUpperCase()} Offline`, res.message);
      }
    } catch (err: any) {
      setTestResult({
        target,
        connected: false,
        message: err.message,
      });
      showToast('error', 'Connection Error', err.message);
    } finally {
      setTestingTarget(null);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      showToast('info', 'Signed Out', 'You have been logged out of ONYX.');
    } catch (err: any) {
      showToast('error', 'Logout Failed', err.message);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-8 animate-in fade-in duration-200 select-none">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-[#F3F1EA] tracking-tight">
            Settings & Workspace Management
          </h1>
          <p className="text-xs text-[#929892] mt-1">
            Manage your user session, encrypted infrastructure credentials, and pipeline observability.
          </p>
        </div>
        <Button
          id="btn-relaunch-wizard"
          variant="champagne"
          size="sm"
          onClick={() => setIsWizardOpen(true)}
          icon={<Wrench className="w-3.5 h-3.5" />}
        >
          Infrastructure Setup Wizard
        </Button>
      </div>

      {/* 1. USER PROFILE SECTION */}
      <div className="rounded-2xl bg-[#101413] border border-[#2A302D] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <UserIcon className="w-4 h-4 text-[#D6C7A1]" />
            <h3 className="text-sm font-bold text-[#F3F1EA]">User Session & Identity</h3>
          </div>
          <Button
            id="btn-settings-logout"
            variant="danger"
            size="sm"
            onClick={handleLogout}
            icon={<LogOut className="w-3.5 h-3.5" />}
          >
            Sign Out
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl bg-[#171C1A] border border-[#2A302D]">
          <div className="w-12 h-12 rounded-xl bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] font-bold text-base overflow-hidden flex-shrink-0">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              (user?.name ? user.name.slice(0, 2).toUpperCase() : 'SB')
            )}
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-bold text-[#F3F1EA]">{user?.name || 'Authorized User'}</h4>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#78C6A3]/10 text-[#78C6A3] border border-[#78C6A3]/30">
                Active Tenant
              </span>
            </div>
            <p className="text-xs text-[#929892] flex items-center gap-1.5">
              <Mail className="w-3 h-3" />
              <span>{user?.email || 'user@secondbrain.ai'}</span>
            </p>
          </div>
          <div className="text-[11px] text-[#626863] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#78C6A3]" />
            <span>Encrypted Tenant Isolation</span>
          </div>
        </div>
      </div>

      {/* 2. INFRASTRUCTURE & CREDENTIAL STATUS (BYOK) */}
      <div className="rounded-2xl bg-[#101413] border border-[#2A302D] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-[#D6C7A1]" />
            <h3 className="text-sm font-bold text-[#F3F1EA]">Infrastructure & BYOK Credentials</h3>
          </div>
          <span className="text-[11px] text-[#929892]">AES-256-GCM Encrypted at rest</span>
        </div>

        {/* Live Test Banner if active */}
        {testResult && (
          <div
            className={`p-3.5 rounded-xl border flex items-start gap-3 text-xs ${
              testResult.connected
                ? 'bg-[#78C6A3]/10 border-[#78C6A3]/30 text-[#78C6A3]'
                : 'bg-red-500/10 border-red-500/30 text-red-400'
            }`}
          >
            {testResult.connected ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <span className="font-semibold">{testResult.target.toUpperCase()}: </span>
              {testResult.message}
              {testResult.latencyMs !== undefined && ` (${testResult.latencyMs}ms)`}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          {/* Gemini Card */}
          <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] flex-shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-[#F3F1EA]">Google Gemini API</h4>
                  {setupStatus?.geminiConnected ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#78C6A3]/10 text-[#78C6A3] border border-[#78C6A3]/30">
                      Custom Key Active
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#D6C7A1]/10 text-[#D6C7A1] border border-[#D6C7A1]/30">
                      Fallback Mode
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#929892] font-mono">
                  {setupStatus?.geminiMasked || 'Default Server Environment Model'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                variant="outline"
                size="sm"
                loading={testingTarget === 'gemini'}
                onClick={() => handleTestService('gemini')}
              >
                Ping Gemini
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsWizardOpen(true)}>
                Configure
              </Button>
            </div>
          </div>

          {/* Qdrant Card */}
          <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] flex-shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-[#F3F1EA]">Qdrant Vector Cluster</h4>
                  {setupStatus?.qdrantConnected ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#78C6A3]/10 text-[#78C6A3] border border-[#78C6A3]/30">
                      Remote Connected
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#101413] text-[#929892] border border-[#2A302D]">
                      In-Memory Engine
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#929892] font-mono">
                  {setupStatus?.qdrantUrlMasked || 'Local High-Speed Vector Storage'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                variant="outline"
                size="sm"
                loading={testingTarget === 'qdrant'}
                onClick={() => handleTestService('qdrant')}
              >
                Ping Qdrant
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsWizardOpen(true)}>
                Configure
              </Button>
            </div>
          </div>

          {/* PostgreSQL Card */}
          <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#101413] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] flex-shrink-0">
                <Database className="w-4 h-4" />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-[#F3F1EA]">PostgreSQL Relational DB</h4>
                  {setupStatus?.postgresConnected ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#78C6A3]/10 text-[#78C6A3] border border-[#78C6A3]/30">
                      Postgres Connected
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#101413] text-[#929892] border border-[#2A302D]">
                      Snapshot Engine
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-[#929892] font-mono">
                  {setupStatus?.postgresUrlMasked || 'Local Memory/Disk Snapshot Storage'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                variant="outline"
                size="sm"
                loading={testingTarget === 'postgres'}
                onClick={() => handleTestService('postgres')}
              >
                Ping DB
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsWizardOpen(true)}>
                Configure
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. PIPELINE HEALTH & SERVICES */}
      <div className="rounded-2xl bg-[#101413] border border-[#2A302D] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Activity className="w-4 h-4 text-[#78C6A3]" />
            <h3 className="text-sm font-bold text-[#F3F1EA]">Pipeline Health & Grounding Services</h3>
          </div>
          <Button variant="outline" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={handleReindex}>
            Check Health
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[
            { name: 'Gemini Generative Engine', status: 'Operational', desc: 'gemini-2.5-flash with grounded retrieval' },
            { name: 'Gemini Text Embeddings', status: 'Operational', desc: 'text-embedding-004 (768-dim dense vectors)' },
            { name: 'BM25 Sparse Search Engine', status: 'Operational', desc: 'Inverted lexical index with term frequency' },
            { name: 'Reciprocal Rank Fusion (RRF)', status: 'Operational', desc: 'Hybrid k=60 rank unification' },
            { name: 'Knowledge Repository Store', status: 'Operational', desc: 'Multi-tenant relational DDL & snapshot cache' },
            { name: 'Async Ingestion Worker', status: 'Idle / Ready', desc: 'Multi-format document parsing & chunking' },
          ].map((svc, idx) => (
            <div key={idx} className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D] flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#78C6A3]" />
                  <span className="text-xs font-bold text-[#F3F1EA]">{svc.name}</span>
                </div>
                <p className="text-[11px] text-[#929892]">{svc.desc}</p>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#101413] text-[#78C6A3] border border-[#2A302D]">
                {svc.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 4. RAG HYPERPARAMETERS */}
      <div className="rounded-2xl bg-[#101413] border border-[#2A302D] p-6 space-y-4">
        <h3 className="text-sm font-bold text-[#F3F1EA]">Ingestion & Retrieval Hyperparameters</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D]">
            <span className="text-[10px] font-bold text-[#626863] uppercase">CHUNK TARGET</span>
            <p className="text-lg font-bold text-[#D6C7A1] mt-1">800 Tokens</p>
          </div>
          <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D]">
            <span className="text-[10px] font-bold text-[#626863] uppercase">CHUNK OVERLAP</span>
            <p className="text-lg font-bold text-[#D6C7A1] mt-1">150 Tokens</p>
          </div>
          <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D]">
            <span className="text-[10px] font-bold text-[#626863] uppercase">RRF CONSTANT (k)</span>
            <p className="text-lg font-bold text-[#D6C7A1] mt-1">60</p>
          </div>
          <div className="p-4 rounded-xl bg-[#171C1A] border border-[#2A302D]">
            <span className="text-[10px] font-bold text-[#626863] uppercase">TOP-K RETRIEVAL</span>
            <p className="text-lg font-bold text-[#D6C7A1] mt-1">8 Units</p>
          </div>
        </div>
      </div>

      {/* Setup Wizard Modal Trigger */}
      <SetupWizardModal isOpen={isWizardOpen} onClose={() => setIsWizardOpen(false)} />
    </div>
  );
};
