/**
 * Second Brain — Notification Context
 * Real-time notification management with backend sync & unread counter
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AppNotification } from '../types';
import { api } from '../services/api';

interface NotificationContextType {
  notifications: AppNotification[];
  unreadCount: number;
  isPanelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  clearAll: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  addLocalNotification: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const refreshNotifications = useCallback(async () => {
    try {
      const res = await api.getNotifications(30);
      setNotifications(res.notifications || []);
    } catch (err) {
      console.warn('[NotificationContext] Failed to fetch notifications:', err);
    }
  }, []);

  // Fetch initial notifications and poll periodically (every 5 seconds)
  useEffect(() => {
    refreshNotifications();
    const interval = setInterval(refreshNotifications, 5000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const openPanel = () => setIsPanelOpen(true);
  const closePanel = () => setIsPanelOpen(false);
  const togglePanel = () => setIsPanelOpen(prev => !prev);

  const markAsRead = async (id: string) => {
    // Optimistic UI update
    setNotifications(prev =>
      prev.map(n => (n.id === id ? { ...n, read: true } : n))
    );
    try {
      await api.markNotificationRead(id);
    } catch (err) {
      console.error('[NotificationContext] Failed to mark notification read:', err);
      refreshNotifications();
    }
  };

  const markAllAsRead = async () => {
    // Optimistic UI update
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try {
      await api.markAllNotificationsRead();
    } catch (err) {
      console.error('[NotificationContext] Failed to mark all notifications read:', err);
      refreshNotifications();
    }
  };

  const clearAll = async () => {
    // Optimistic UI update
    setNotifications([]);
    try {
      await api.clearNotifications();
    } catch (err) {
      console.error('[NotificationContext] Failed to clear notifications:', err);
      refreshNotifications();
    }
  };

  const addLocalNotification = (notif: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => {
    const newNotif: AppNotification = {
      ...notif,
      id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isPanelOpen,
        openPanel,
        closePanel,
        togglePanel,
        markAsRead,
        markAllAsRead,
        clearAll,
        refreshNotifications,
        addLocalNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};
