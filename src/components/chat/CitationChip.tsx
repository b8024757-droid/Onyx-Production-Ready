/**
 * Second Brain — Interactive Citation Chip Component
 * Rendered inline inside AI responses (e.g. [01], [02]). Clicking opens Evidence Inspector.
 */

import React from 'react';
import { Citation } from '../../types';
import { useUI } from '../../context/UIContext';

interface CitationChipProps {
  citationIndex: number;
  citation?: Citation;
}

export const CitationChip: React.FC<CitationChipProps> = ({ citationIndex, citation }) => {
  const { inspectCitation, activeEvidenceCitation } = useUI();
  const label = citationIndex < 10 ? `0${citationIndex}` : `${citationIndex}`;

  const isSelected = activeEvidenceCitation?.citationIndex === citationIndex;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (citation) {
      inspectCitation(citation);
    }
  };

  return (
    <button
      onClick={handleClick}
      title={citation ? `Source: ${citation.documentTitle} (Click to inspect evidence)` : `Citation ${label}`}
      className={`inline-flex items-center justify-center px-1.5 py-0.5 mx-1 rounded text-[11px] font-mono font-bold tracking-tight transition-all cursor-pointer select-none active:scale-95 ${
        isSelected
          ? 'bg-[#D6C7A1] text-[#080A0A] border border-[#F0E4C2] shadow-sm'
          : 'bg-[#171C1A] hover:bg-[#1C2220] text-[#D6C7A1] border border-[#D6C7A1]/40 hover:border-[#D6C7A1]'
      }`}
    >
      {label}
    </button>
  );
};
