/**
 * Second Brain — Common Button Component
 */

import React from 'react';

export type ButtonVariant = 'champagne' | 'outline' | 'ghost' | 'emerald' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'champagne',
  size = 'md',
  icon,
  loading = false,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const sizeStyles = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  }[size];

  const variantStyles = {
    champagne:
      'bg-[#D6C7A1] hover:bg-[#F0E4C2] text-[#080A0A] font-semibold shadow-sm hover:shadow-[#D6C7A1]/10',
    outline:
      'bg-[#101413] hover:bg-[#171C1A] text-[#F3F1EA] border border-[#2A302D] hover:border-[#3E4743]',
    ghost:
      'bg-transparent hover:bg-[#171C1A] text-[#929892] hover:text-[#F3F1EA]',
    emerald:
      'bg-[#78C6A3] hover:bg-[#9BE2BF] text-[#080A0A] font-semibold shadow-sm',
    danger:
      'bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30',
  }[variant];

  return (
    <button
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        icon && <span className="flex-shrink-0">{icon}</span>
      )}
      <span>{children}</span>
    </button>
  );
};
