/**
 * Second Brain — Knowledge Base Library View
 */

import React, { useState } from 'react';
import { useKnowledge } from '../../context/KnowledgeContext';
import { useUI } from '../../context/UIContext';
import { Document, DocumentCategory } from '../../types';
import { DocumentCard } from './DocumentCard';
import { DocumentDetailModal } from './DocumentDetailModal';
import { Search, Plus, Filter, FileText, Layers } from 'lucide-react';
import { Button } from '../common/Button';

export const KnowledgeView: React.FC = () => {
  const {
    documents,
    selectedCategory,
    setSelectedCategory,
    searchQuery,
    setSearchQuery,
    deleteDocument,
  } = useKnowledge();
  const { openAddKnowledge } = useUI();
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);

  const categories: DocumentCategory[] = [
    'All',
    'Documents',
    'Presentations',
    'Notes',
    'Web',
    'Images',
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-7 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-extrabold text-[#F3F1EA] tracking-tight">
            Knowledge Base
          </h1>
          <p className="text-xs text-[#929892] mt-1">
            {documents.length} verified sources indexed and ready for grounded retrieval.
          </p>
        </div>

        <Button
          variant="champagne"
          size="md"
          icon={<Plus className="w-4 h-4 stroke-[2.5]" />}
          onClick={openAddKnowledge}
        >
          Add Knowledge
        </Button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Category Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {categories.map(cat => {
            const isSelected = selectedCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-[#171C1A] text-[#F0E4C2] border border-[#D6C7A1]/40 shadow-sm'
                    : 'text-[#929892] hover:text-[#F3F1EA] hover:bg-[#101413]'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>

        {/* Local Search Input */}
        <div className="w-full sm:w-72 relative">
          <Search className="w-3.5 h-3.5 text-[#929892] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter library by title or tag..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#101413] border border-[#2A302D] focus:border-[#D6C7A1] rounded-lg pl-9 pr-3 py-1.5 text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Document Cards Grid */}
      {documents.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-[#101413] border border-[#2A302D] space-y-3">
          <FileText className="w-8 h-8 text-[#626863] mx-auto" />
          <p className="text-sm font-semibold text-[#F3F1EA]">No documents found</p>
          <p className="text-xs text-[#929892]">
            Upload or import your first document to start building your ONYX workspace.
          </p>
          <Button variant="champagne" size="sm" onClick={openAddKnowledge}>
            Add Knowledge
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {documents.map(doc => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onSelect={setSelectedDoc}
              onDelete={deleteDocument}
            />
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <DocumentDetailModal
        document={selectedDoc}
        onClose={() => setSelectedDoc(null)}
        onDelete={deleteDocument}
      />
    </div>
  );
};
