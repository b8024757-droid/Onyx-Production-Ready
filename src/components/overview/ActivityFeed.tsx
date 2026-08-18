/**
 * Second Brain — Activity Feed Component
 * Displays the live timeline of indexing and knowledge queries
 */

import React from 'react';
import { useKnowledge } from '../../context/KnowledgeContext';
import { CheckCircle2, Search, PlusCircle, FolderPlus } from 'lucide-react';

export const ActivityFeed: React.FC = () => {
  const { stats } = useKnowledge();

  const activities = stats?.recentActivity || [];

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'index_complete':
        return <span className="w-2 h-2 rounded-full bg-[#78C6A3] mt-1.5 flex-shrink-0" />;
      case 'search':
        return <span className="w-2 h-2 rounded-full bg-[#D6C7A1] mt-1.5 flex-shrink-0" />;
      default:
        return <span className="w-2 h-2 rounded-full bg-[#929892] mt-1.5 flex-shrink-0" />;
    }
  };

  return (
    <div className="rounded-2xl bg-[#101413] border border-[#2A302D] p-5 space-y-4">
      <h3 className="text-sm font-bold text-[#F3F1EA] tracking-wide">
        Activity
      </h3>

      <div className="space-y-4">
        {activities.map((act, index) => (
          <div key={act.id || index} className="flex items-start gap-3 text-xs">
            {getActivityIcon(act.type)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#F3F1EA]">
                  {act.title}
                </span>
                <span className="text-[10px] text-[#626863]">
                  {act.timestamp}
                </span>
              </div>
              <p className="text-[#929892] text-[11px] mt-0.5 leading-relaxed truncate">
                {act.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
