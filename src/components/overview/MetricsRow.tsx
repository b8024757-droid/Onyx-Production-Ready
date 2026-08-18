/**
 * Second Brain — Metrics Row Component
 * Displays the 4 metric cards: Sources, Collections, Units, and Indexed %
 */

import React from 'react';
import { useKnowledge } from '../../context/KnowledgeContext';
import { Database, FolderTree, Cpu, CheckCircle2 } from 'lucide-react';

export const MetricsRow: React.FC = () => {
  const { stats } = useKnowledge();

  const metrics = [
    {
      id: 'metric-sources',
      value: stats ? stats.sourcesCount.toLocaleString() : '1,248',
      label: 'Sources',
      icon: <Database className="w-4 h-4 text-[#929892]" />,
    },
    {
      id: 'metric-collections',
      value: stats ? stats.collectionsCount.toString() : '86',
      label: 'Collections',
      icon: <FolderTree className="w-4 h-4 text-[#929892]" />,
    },
    {
      id: 'metric-units',
      value: stats ? `${stats.unitsCount}K` : '24.6K',
      label: 'Units',
      icon: <Cpu className="w-4 h-4 text-[#929892]" />,
    },
    {
      id: 'metric-indexed',
      value: stats ? `${stats.indexedPercentage}%` : '98%',
      label: 'Indexed',
      icon: <span className="w-2 h-2 rounded-full bg-[#78C6A3] animate-pulse" />,
      highlight: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {metrics.map(m => (
        <div
          key={m.id}
          id={m.id}
          className="p-5 rounded-xl bg-[#101413] border border-[#2A302D] hover:border-[#3E4743] transition-all"
        >
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold tracking-tight text-[#F3F1EA] tabular-nums">
              {m.value}
            </span>
            <div>{m.icon}</div>
          </div>
          <p className="text-xs font-medium text-[#929892] mt-1 tracking-wide">
            {m.label}
          </p>
        </div>
      ))}
    </div>
  );
};
