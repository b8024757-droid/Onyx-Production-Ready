/**
 * Second Brain — Notification Panel Component
 * Compact dropdown anchored to the top-bar bell button.
 * Uses Obsidian/Champagne visual styling, supports SUCCESS/INFO/ERROR tags,
 * keyboard Escape to close, click outside, and "Mark all as read".
 */

import React, { useEffect, useRef } from 'react';
import { useNotifications } from '../../context/NotificationContext';
import { useUI } from '../../context/UIContext';
import { CheckCircle2, Info, AlertTriangle, Check, Bell, Trash2, X, ExternalLink } from 'lucide-react';

interface NotificationPanelProps {
  onClose: () => void;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({ onClose }) => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const { setActiveTab } = useUI();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Only close if not clicking the notification bell button itself
        const bellBtn = document.getElementById('btn-notifications');
        if (bellBtn && bellBtn.contains(e.target as Node)) {
          return;
        }
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const formatTimestamp = (iso: string) => {
    try {
      const date = new Date(iso);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / (1000 * 60));
      const diffHours = Math.floor(diffMins / 60);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch {
      return 'Recently';
    }
  };

  const getTypeIcon = (type: 'SUCCESS' | 'INFO' | 'ERROR') => {
    switch (type) {
      case 'SUCCESS':
        return <CheckCircle2 className="w-4 h-4 text-[#78C6A3] shrink-0" />;
      case 'ERROR':
        return <AlertTriangle className="w-4 h-4 text-[#E58585] shrink-0" />;
      case 'INFO':
      default:
        return <Info className="w-4 h-4 text-[#D6C7A1] shrink-0" />;
    }
  };

  const handleNotificationClick = (notif: typeof notifications[0]) => {
    if (!notif.read) {
      markAsRead(notif.id);
    }
    if (notif.linkTab) {
      setActiveTab(notif.linkTab as any);
      onClose();
    }
  };

  return (
    <div
      ref={panelRef}
      id="notification-dropdown-panel"
      role="region"
      aria-label="Notifications"
      className="absolute right-0 top-11 w-80 sm:w-96 rounded-xl bg-[#101413] border border-[#2A302D] shadow-2xl z-50 overflow-hidden flex flex-col max-h-[460px] animate-in fade-in zoom-in-95 duration-150"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E2422] bg-[#0C0F0E]">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-[#D6C7A1]" />
          <span className="text-xs font-semibold text-[#F3F1EA] tracking-wide">Notifications</span>
          {unreadCount > 0 && (
            <span
              id="notification-unread-count-badge"
              className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-[#78C6A3]/20 text-[#78C6A3] border border-[#78C6A3]/30"
            >
              {unreadCount} new
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              id="btn-mark-all-read"
              onClick={markAllAsRead}
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#929892] hover:text-[#F3F1EA] hover:bg-[#171C1A] transition-colors cursor-pointer"
              title="Mark all as read"
            >
              <Check className="w-3 h-3" />
              <span>Mark all read</span>
            </button>
          )}

          {notifications.length > 0 && (
            <button
              id="btn-clear-all-notifications"
              onClick={clearAll}
              className="p-1 rounded text-[#929892] hover:text-[#E58585] hover:bg-[#171C1A] transition-colors cursor-pointer"
              title="Clear all notifications"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            id="btn-close-notification-panel"
            onClick={onClose}
            aria-label="Close notifications"
            className="p-1 rounded text-[#929892] hover:text-[#F3F1EA] hover:bg-[#171C1A] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Notifications List */}
      <div className="flex-1 overflow-y-auto divide-y divide-[#1A201E]">
        {notifications.length === 0 ? (
          <div className="py-10 px-4 text-center flex flex-col items-center justify-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#171C1A] border border-[#2A302D] flex items-center justify-center text-[#626863]">
              <Bell className="w-4 h-4" />
            </div>
            <p className="text-xs text-[#929892]">No notifications yet</p>
            <p className="text-[11px] text-[#626863] max-w-[220px]">
              Upload documents or create collections to see real-time updates here.
            </p>
          </div>
        ) : (
          notifications.map(notif => (
            <div
              key={notif.id}
              id={`notification-item-${notif.id}`}
              onClick={() => handleNotificationClick(notif)}
              className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer relative group ${
                notif.read
                  ? 'bg-transparent hover:bg-[#141918]/60 opacity-80'
                  : 'bg-[#141A18]/80 hover:bg-[#17201D]'
              }`}
            >
              {/* Type Icon */}
              <div className="mt-0.5">{getTypeIcon(notif.type)}</div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-xs font-semibold truncate ${
                      notif.read ? 'text-[#C5CCC8]' : 'text-[#F3F1EA]'
                    }`}
                  >
                    {notif.title}
                  </span>
                  <span className="text-[10px] text-[#626863] shrink-0 font-mono">
                    {formatTimestamp(notif.timestamp)}
                  </span>
                </div>
                <p className="text-[11px] text-[#929892] mt-0.5 line-clamp-2 leading-relaxed">
                  {notif.message}
                </p>

                {notif.linkTab && (
                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-[#D6C7A1] group-hover:underline">
                    <span>View in {notif.linkTab}</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </div>
                )}
              </div>

              {/* Unread indicator / mark read button */}
              <div className="flex items-center self-center shrink-0">
                {!notif.read ? (
                  <button
                    id={`btn-mark-read-${notif.id}`}
                    onClick={e => {
                      e.stopPropagation();
                      markAsRead(notif.id);
                    }}
                    className="w-2 h-2 rounded-full bg-[#78C6A3] hover:scale-125 transition-transform"
                    title="Mark as read"
                  />
                ) : (
                  <div className="w-2 h-2" />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
