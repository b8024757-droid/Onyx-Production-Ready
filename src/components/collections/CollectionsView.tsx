/**
 * Second Brain — Collections Management View
 */

import React, { useState } from 'react';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useUI } from '../../context/UIContext';
import { useChat } from '../../context/ChatContext';
import { FolderTree, Plus, BookOpen, MessageSquare, Layers, Trash2, X } from 'lucide-react';
import { Button } from '../common/Button';

export const CollectionsView: React.FC = () => {
  const { collections, documents, createCollection } = useKnowledge();
  const { setActiveTab } = useUI();
  const { startNewConversation } = useChat();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [newColTag, setNewColTag] = useState('');

  const handleCreate = async () => {
    if (!newColName.trim()) return;
    const tags = newColTag ? newColTag.split(',').map(t => t.trim()).filter(Boolean) : [];
    await createCollection(newColName.trim(), newColDesc.trim(), tags);
    setNewColName('');
    setNewColDesc('');
    setNewColTag('');
    setIsCreateModalOpen(false);
  };

  const handleChatWithCollection = async (colId: string, colName: string) => {
    await startNewConversation(`Focus: ${colName}`);
    setActiveTab('chat');
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-7 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-[#F3F1EA] tracking-tight">
            Collections
          </h1>
          <p className="text-xs text-[#929892] mt-1">
            Group knowledge items into scoped research areas and projects.
          </p>
        </div>

        <Button
          variant="champagne"
          size="md"
          icon={<Plus className="w-4 h-4 stroke-[2.5]" />}
          onClick={() => setIsCreateModalOpen(true)}
        >
          New Collection
        </Button>
      </div>

      {/* Collections Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {collections.map(col => {
          const colDocs = documents.filter(d => d.collectionId === col.id);
          const docCount = colDocs.length || col.documentCount;

          return (
            <div
              key={col.id}
              className="p-5 rounded-2xl bg-[#101413] border border-[#2A302D] hover:border-[#3E4743] flex flex-col justify-between space-y-4 transition-all group"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg bg-[#171C1A] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1]">
                    <FolderTree className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-[#171C1A] text-[#929892] border border-[#2A302D]">
                    {docCount} {docCount === 1 ? 'Source' : 'Sources'}
                  </span>
                </div>

                <h3 className="text-base font-bold text-[#F3F1EA] group-hover:text-[#D6C7A1] transition-colors mt-3">
                  {col.name}
                </h3>
                <p className="text-xs text-[#929892] mt-1.5 line-clamp-2 leading-relaxed">
                  {col.description || 'Collection workspace for related assets.'}
                </p>
              </div>

              <div className="pt-3 border-t border-[#2A302D] flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {col.tags?.slice(0, 2).map(t => (
                    <span
                      key={t}
                      className="text-[10px] px-2 py-0.5 rounded bg-[#171C1A] text-[#929892] border border-[#2A302D]"
                    >
                      {t}
                    </span>
                  ))}
                </div>

                <button
                  onClick={() => handleChatWithCollection(col.id, col.name)}
                  className="text-xs font-semibold text-[#D6C7A1] hover:text-[#F0E4C2] flex items-center gap-1 transition-colors"
                >
                  <MessageSquare className="w-3 h-3" />
                  <span>Ask Scope</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* New Collection Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#101413] border border-[#2A302D] rounded-2xl shadow-2xl overflow-hidden p-6 space-y-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-[#2A302D] pb-3">
              <h3 className="text-sm font-bold text-[#F3F1EA]">Create New Collection</h3>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="text-[#929892] hover:text-[#F3F1EA]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                  Collection Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Distributed Systems Architecture"
                  value={newColName}
                  onChange={e => setNewColName(e.target.value)}
                  className="w-full bg-[#171C1A] border border-[#2A302D] rounded-lg px-3 py-2 text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none focus:border-[#D6C7A1]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Brief summary of topics and documents in this collection..."
                  value={newColDesc}
                  onChange={e => setNewColDesc(e.target.value)}
                  className="w-full bg-[#171C1A] border border-[#2A302D] rounded-lg px-3 py-2 text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none focus:border-[#D6C7A1] resize-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Systems, Scaling, Consensus"
                  value={newColTag}
                  onChange={e => setNewColTag(e.target.value)}
                  className="w-full bg-[#171C1A] border border-[#2A302D] rounded-lg px-3 py-2 text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none focus:border-[#D6C7A1]"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setIsCreateModalOpen(false)}>
                Cancel
              </Button>
              <Button variant="champagne" size="sm" onClick={handleCreate} disabled={!newColName.trim()}>
                Create Collection
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
