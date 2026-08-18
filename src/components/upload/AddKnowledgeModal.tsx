/**
 * Second Brain — Add Knowledge Modal
 * Matches Stitch design specification: Files/Web tabs, drag-and-drop zone, live ingestion progress bar
 */

import React, { useState, useRef } from 'react';
import { useUI } from '../../context/UIContext';
import { useKnowledge } from '../../context/KnowledgeContext';
import { UploadCloud, FileText, Globe, X, Link as LinkIcon } from 'lucide-react';
import { Button } from '../common/Button';
import { DocumentType } from '../../types';

export const AddKnowledgeModal: React.FC = () => {
  const { isAddKnowledgeOpen, closeAddKnowledge, showToast } = useUI();
  const { uploadKnowledge, collections, activeJobs } = useKnowledge();
  const [activeTab, setActiveTab] = useState<'files' | 'web'>('files');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    content: string;
    type: DocumentType;
    sizeBytes: number;
  } | null>(null);
  const [webUrl, setWebUrl] = useState('');
  const [webTitle, setWebTitle] = useState('');
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isAddKnowledgeOpen) return null;

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFileInput(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFileInput(e.target.files[0]);
    }
  };

  const processFileInput = (file: File) => {
    const reader = new FileReader();
    const extension = file.name.split('.').pop()?.toUpperCase() || 'TXT';
    let docType: DocumentType = 'TXT';
    if (['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'TXT', 'MD', 'CSV', 'XLS', 'XLSX', 'HTML'].includes(extension)) {
      docType = extension as DocumentType;
    } else if (file.type.startsWith('image/')) {
      docType = 'IMAGE';
    }

    if (['PDF', 'DOC', 'DOCX', 'PPT', 'PPTX', 'XLS', 'XLSX', 'IMAGE'].includes(docType)) {
      reader.onload = e => {
        const content = e.target?.result as string;
        setSelectedFile({
          name: file.name,
          content: content || '',
          type: docType,
          sizeBytes: file.size,
        });
      };
      reader.readAsDataURL(file);
    } else {
      reader.onload = e => {
        const content = e.target?.result as string;
        setSelectedFile({
          name: file.name,
          content: content || '',
          type: docType,
          sizeBytes: file.size,
        });
      };
      reader.readAsText(file);
    }
  };

  const handleImport = async () => {
    setIsSubmitting(true);
    try {
      if (activeTab === 'files' && selectedFile) {
        await uploadKnowledge({
          name: selectedFile.name,
          content: selectedFile.content,
          type: selectedFile.type,
          sizeBytes: selectedFile.sizeBytes,
          collectionId: selectedCollectionId || undefined,
        });
        setSelectedFile(null);
        closeAddKnowledge();
      } else if (activeTab === 'web' && webUrl.trim()) {
        const title = webTitle.trim() || webUrl.replace(/^https?:\/\//, '');
        await uploadKnowledge({
          name: title,
          content: '',
          type: 'URL',
          sizeBytes: 0,
          sourceUrl: webUrl.trim(),
          collectionId: selectedCollectionId || undefined,
        });
        setWebUrl('');
        setWebTitle('');
        closeAddKnowledge();
      }
    } catch (e: any) {
      showToast('error', 'Import Failed', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        id="add-knowledge-modal"
        className="w-full max-w-xl bg-[#101413] border border-[#2A302D] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 flex items-start justify-between border-b border-[#2A302D]">
          <div>
            <h2 className="text-lg font-bold text-[#F3F1EA] tracking-tight">
              Add knowledge to your ONYX workspace
            </h2>
            <p className="text-xs text-[#929892] mt-0.5">
              Bring in anything worth remembering.
            </p>
          </div>
          <button
            onClick={closeAddKnowledge}
            className="p-1.5 text-[#929892] hover:text-[#F3F1EA] rounded-lg hover:bg-[#171C1A] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-[#2A302D] px-6">
          <button
            onClick={() => setActiveTab('files')}
            className={`py-3 px-4 text-xs font-bold tracking-wider transition-all relative ${
              activeTab === 'files'
                ? 'text-[#F3F1EA]'
                : 'text-[#929892] hover:text-[#F3F1EA]'
            }`}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              <span>FILES</span>
            </div>
            {activeTab === 'files' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D6C7A1]" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('web')}
            className={`py-3 px-4 text-xs font-bold tracking-wider transition-all relative ${
              activeTab === 'web'
                ? 'text-[#F3F1EA]'
                : 'text-[#929892] hover:text-[#F3F1EA]'
            }`}
          >
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5" />
              <span>WEB</span>
            </div>
            {activeTab === 'web' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#D6C7A1]" />
            )}
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 space-y-5">
          {/* Target Collection Selection */}
          <div>
            <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
              Assign to Collection (Optional)
            </label>
            <select
              value={selectedCollectionId}
              onChange={e => setSelectedCollectionId(e.target.value)}
              className="w-full bg-[#171C1A] border border-[#2A302D] rounded-lg px-3.5 py-2 text-xs text-[#F3F1EA] focus:outline-none focus:border-[#D6C7A1]"
            >
              <option value="">General Knowledge (No Collection)</option>
              {collections.map(col => (
                <option key={col.id} value={col.id}>
                  {col.name} ({col.documentCount} sources)
                </option>
              ))}
            </select>
          </div>

          {activeTab === 'files' ? (
            <div>
              {/* Dropzone */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileInputChange}
                className="hidden"
                accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.csv,.xls,.xlsx,image/*"
              />
              <div
                onDragOver={e => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-[#D6C7A1] bg-[#D6C7A1]/5'
                    : selectedFile
                    ? 'border-[#78C6A3]/50 bg-[#78C6A3]/5'
                    : 'border-[#2A302D] hover:border-[#3E4743] bg-[#171C1A]/40'
                }`}
              >
                <div className="w-12 h-12 mx-auto rounded-full bg-[#171C1A] border border-[#2A302D] flex items-center justify-center text-[#D6C7A1] mb-3">
                  <UploadCloud className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-[#F3F1EA]">
                  {selectedFile ? selectedFile.name : 'Click to upload or drag and drop'}
                </p>
                <p className="text-xs text-[#929892] mt-1">
                  PDF, DOCX, PPTX, XLSX, CSV, MD, TXT, images (max. 50MB)
                </p>
              </div>
            </div>
          ) : (
            /* Web URL Import Form */
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                  Web Page URL
                </label>
                <div className="flex items-center gap-2 bg-[#171C1A] border border-[#2A302D] rounded-lg px-3 py-2">
                  <LinkIcon className="w-4 h-4 text-[#929892]" />
                  <input
                    type="url"
                    placeholder="https://example.com/article"
                    value={webUrl}
                    onChange={e => setWebUrl(e.target.value)}
                    className="flex-1 bg-transparent text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#929892] uppercase tracking-wider mb-1.5">
                  Custom Title (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Design Systems Overview"
                  value={webTitle}
                  onChange={e => setWebTitle(e.target.value)}
                  className="w-full bg-[#171C1A] border border-[#2A302D] rounded-lg px-3.5 py-2 text-xs text-[#F3F1EA] placeholder-[#626863] focus:outline-none focus:border-[#D6C7A1]"
                />
              </div>
            </div>
          )}

          {/* In Progress Section */}
          {activeJobs.length > 0 && (
            <div className="border-t border-[#2A302D] pt-4">
              <div className="text-[10px] font-bold text-[#626863] uppercase tracking-wider mb-2.5">
                IN PROGRESS
              </div>
              {activeJobs.map(job => (
                <div
                  key={job.id}
                  className="p-3 bg-[#171C1A] border border-[#2A302D] rounded-xl space-y-2 mb-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 text-[#F3F1EA]">
                      <FileText className="w-3.5 h-3.5 text-[#D6C7A1]" />
                      <span className="font-semibold">{job.fileName || job.documentTitle || 'Document'}</span>
                      <span className="text-[#929892]">| {job.stepMessage || job.stageMessage || 'Processing...'}</span>
                    </div>
                    <span className="font-bold text-[#D6C7A1]">{job.progress}%</span>
                  </div>

                  {/* Progress Bar with Champagne Fill */}
                  <div className="w-full h-1.5 bg-[#080A0A] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#D6C7A1] transition-all duration-300 rounded-full"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 bg-[#080A0A] border-t border-[#2A302D] flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={closeAddKnowledge}>
            Cancel
          </Button>
          <Button
            variant="champagne"
            onClick={handleImport}
            loading={isSubmitting}
            disabled={activeTab === 'files' ? !selectedFile : !webUrl.trim()}
          >
            Import {activeTab === 'files' ? 'Files' : 'Source'}
          </Button>
        </div>
      </div>
    </div>
  );
};
