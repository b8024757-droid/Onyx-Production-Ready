/**
 * Second Brain — Formatting & Visual Helpers
 */

import { DocumentType } from '../types';

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getDocumentTypeBadge(type: DocumentType): { label: string; color: string; bg: string } {
  switch (type) {
    case 'PDF':
      return { label: 'PDF', color: '#F87171', bg: 'rgba(239, 68, 68, 0.12)' };
    case 'MD':
    case 'TXT':
      return { label: type, color: '#D6C7A1', bg: 'rgba(214, 199, 161, 0.12)' };
    case 'PPT':
    case 'PPTX':
      return { label: 'DECK', color: '#FB923C', bg: 'rgba(251, 146, 60, 0.12)' };
    case 'URL':
    case 'HTML':
      return { label: 'WEB', color: '#78C6A3', bg: 'rgba(120, 198, 163, 0.12)' };
    case 'CSV':
    case 'XLS':
    case 'XLSX':
      return { label: 'DATA', color: '#38BDF8', bg: 'rgba(56, 189, 248, 0.12)' };
    default:
      return { label: 'DOC', color: '#929892', bg: 'rgba(146, 152, 146, 0.12)' };
  }
}
