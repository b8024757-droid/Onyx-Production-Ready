/**
 * Second Brain — Authentication Context
 * Manages user state, session persistence, login/signup/reset flows, and setup status
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User, SetupStatus } from '../types';
import { api, getAuthToken, setAuthToken } from '../services/api';

export type AuthView = 'login' | 'signup' | 'forgot-password' | 'reset-password';

interface AuthContextType {
  user: User | null;
  token: string | null;
  setupStatus: SetupStatus | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authView: AuthView;
  resetToken: string | null;
  setAuthView: (view: AuthView) => void;
  setResetToken: (token: string | null) => void;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  signup: (data: { name: string; email: string; password: string; confirmPassword?: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshSetupStatus: () => Promise<void>;
  setSetupStatus: React.Dispatch<React.SetStateAction<SetupStatus | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(getAuthToken());
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authView, setAuthView] = useState<AuthView>('login');
  const [resetToken, setResetToken] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    const activeToken = getAuthToken();
    if (!activeToken) {
      setUser(null);
      setSetupStatus(null);
      setIsLoading(false);
      return;
    }

    try {
      const data = await api.getCurrentUser();
      setUser(data.user);
      setSetupStatus(data.setupStatus);
    } catch (err) {
      console.warn('[AuthContext] Session invalid or expired, clearing token:', err);
      setAuthToken(null);
      setToken(null);
      setUser(null);
      setSetupStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshSetupStatus = useCallback(async () => {
    try {
      const data = await api.getSetupStatus();
      setSetupStatus(data.setupStatus);
    } catch (err) {
      console.warn('[AuthContext] Failed to refresh setup status:', err);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (credentials: { email: string; password: string }) => {
    const data = await api.login(credentials);
    setUser(data.user);
    setToken(data.token);
    setSetupStatus(data.setupStatus);
  };

  const signup = async (dataPayload: { name: string; email: string; password: string; confirmPassword?: string }) => {
    const data = await api.signup(dataPayload);
    setUser(data.user);
    setToken(data.token);
    setSetupStatus(data.setupStatus);
  };

  const logout = async () => {
    await api.logout();
    setToken(null);
    setUser(null);
    setSetupStatus(null);
    setAuthView('login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        setupStatus,
        isAuthenticated: !!user,
        isLoading,
        authView,
        resetToken,
        setAuthView,
        setResetToken,
        login,
        signup,
        logout,
        refreshUser,
        refreshSetupStatus,
        setSetupStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
};
