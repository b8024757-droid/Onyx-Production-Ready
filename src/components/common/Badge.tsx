/**
 * Second Brain — Common Badge Component
 */

import React from 'react';

export type BadgeVariant = 'champagne' | 'emerald' | 'obsidian' | 'neutral' | 'red';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'obsidian',
  size = 'md',
  icon,
  className = '',
  onClick,
}) => {
  const sizeStyles = size === 'sm' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  const variantStyles = {
    champagne: 'bg-[#D6C7A1]/15 text-[#F0E4C2] border border-[#D6C7A1]/30',
    emerald: 'bg-[#78C6A3]/15 text-[#9BE2BF] border border-[#78C6A3]/30',
    obsidian: 'bg-[#171C1A] text-[#929892] border border-[#2A302D]',
    neutral: 'bg-[#1C2220] text-[#F3F1EA] border border-[#2A302D]',
    red: 'bg-red-500/15 text-red-300 border border-red-500/30',
  }[variant];

  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 font-medium rounded-md tracking-wide ${sizeStyles} ${variantStyles} ${
        onClick ? 'cursor-pointer hover:border-[#3E4743]' : ''
      } ${className}`}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      <span>{children}</span>
    </span>
  );
};
