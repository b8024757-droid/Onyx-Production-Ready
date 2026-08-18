/**
 * Second Brain — Top Bar Component
 * Breadcrumbs, global ⌘K search trigger, Quick Add, notifications, and user session menu
 */

import React, { useState, useRef, useEffect } from 'react';
import { useUI } from '../../context/UIContext';
import { useAuth } from '../../context/AuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { NotificationPanel } from './NotificationPanel';
import { Search, Plus, Bell, Command, User, LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';

export const TopBar: React.FC = () => {
  const { activeTab, setActiveTab, openAddKnowledge, openCommandPalette } = useUI();
  const { user, logout } = useAuth();
  const { isPanelOpen, togglePanel, closePanel, unreadCount } = useNotifications();

  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close user dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getBreadcrumbTitle = () => {
    switch (activeTab) {
      case 'overview':
        return 'Overview';
      case 'knowledge':
        return 'Knowledge Base';
      case 'collections':
        return 'Collections';
      case 'search':
        return 'Hybrid Search';
      case 'chat':
        return 'Chat & Grounded Intelligence';
      case 'settings':
        return 'Settings & Observability';
      default:
        return 'Dashboard';
    }
  };

  const getInitials = () => {
    if (!user?.name) return 'OX';
    const parts = user.name.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  };

  return (
    <header
      id="app-topbar"
      className="h-16 border-b border-[#2A302D] bg-[#080A0A]/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-20 select-none"
    >
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[#929892]">ONYX</span>
        <span className="text-[#626863]">/</span>
        <span className="font-semibold text-[#F3F1EA]">{getBreadcrumbTitle()}</span>
      </div>

      {/* Center Search Input Trigger */}
      <div className="flex-1 max-w-md mx-6">
        <button
          id="btn-global-search-trigger"
          onClick={openCommandPalette}
          className="w-full flex items-center justify-between px-3.5 py-1.5 rounded-lg bg-[#101413] border border-[#2A302D] hover:border-[#3E4743] text-xs text-[#929892] transition-colors group cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <Search className="w-3.5 h-3.5 text-[#929892] group-hover:text-[#F3F1EA]" />
            <span>Search anything across your knowledge...</span>
          </div>
          <div className="flex items-center gap-1 bg-[#171C1A] border border-[#2A302D] px-1.5 py-0.5 rounded text-[10px] text-[#929892]">
            <Command className="w-2.5 h-2.5" />
            <span>K</span>
          </div>
        </button>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Quick Add Button */}
        <button
          id="btn-quick-add-topbar"
          onClick={openAddKnowledge}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#D6C7A1] hover:bg-[#F0E4C2] text-[#080A0A] text-xs font-semibold tracking-wide transition-all shadow-sm active:scale-[0.98] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Quick Add</span>
        </button>

        {/* Notification Bell Dropdown Wrapper */}
        <div className="relative">
          <button
            id="btn-notifications"
            onClick={togglePanel}
            aria-expanded={isPanelOpen}
            aria-haspopup="true"
            aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
            className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors relative cursor-pointer ${
              isPanelOpen
                ? 'bg-[#171C1A] text-[#F3F1EA] border-[#D6C7A1]'
                : 'bg-[#101413] hover:bg-[#171C1A] border-[#2A302D] text-[#929892] hover:text-[#F3F1EA]'
            }`}
            title="Notifications"
          >
            <Bell className="w-3.5 h-3.5" />
            {unreadCount > 0 && (
              <span
                id="notification-badge-dot"
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#78C6A3] ring-2 ring-[#080A0A]"
              />
            )}
          </button>

          {isPanelOpen && <NotificationPanel onClose={closePanel} />}
        </div>

        {/* User Profile Avatar with dropdown */}
        <div className="relative" ref={userMenuRef}>
          <button
            id="user-profile-badge"
            onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
            className="w-8 h-8 rounded-lg bg-[#171C1A] hover:bg-[#202724] border border-[#2A302D] flex items-center justify-center text-xs font-semibold text-[#D6C7A1] transition-colors cursor-pointer overflow-hidden"
            title={user?.name || 'User Profile'}
          >
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
            ) : (
              getInitials()
            )}
          </button>

          {isUserMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#101413] border border-[#2A302D] shadow-2xl p-2 z-50 animate-in fade-in duration-150 text-xs">
              <div className="px-3 py-2 border-b border-[#2A302D]/70 space-y-0.5">
                <p className="font-semibold text-[#F3F1EA] truncate">{user?.name || 'ONYX User'}</p>
                <p className="text-[11px] text-[#929892] truncate">{user?.email || 'user@onyx.ai'}</p>
              </div>

              <div className="py-1 space-y-0.5">
                <button
                  onClick={() => {
                    setActiveTab('settings');
                    setIsUserMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[#F3F1EA] hover:bg-[#171C1A] transition-colors text-left"
                >
                  <SettingsIcon className="w-3.5 h-3.5 text-[#929892]" />
                  <span>Settings & BYOK</span>
                </button>
              </div>

              <div className="pt-1 border-t border-[#2A302D]/70">
                <button
                  onClick={async () => {
                    setIsUserMenuOpen(false);
                    await logout();
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors text-left"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
