/**
 * ONYX — Authentication Screens
 * Integrated Stitch login, signup, forgot password, and reset password views.
 */

import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import { api } from '../../services/api';
import {
  Brain,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Database,
  Search,
} from 'lucide-react';
import { Button } from '../common/Button';

export const AuthScreen: React.FC = () => {
  const { authView, setAuthView, login, signup, resetToken, setResetToken } = useAuth();
  const { showToast } = useUI();

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [tokenInput, setTokenInput] = useState(resetToken || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [generatedResetToken, setGeneratedResetToken] = useState<string | null>(null);

  const resetMessages = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!email || !password) {
      setErrorMsg('Please provide both email and password.');
      return;
    }
    setIsLoading(true);
    try {
      await login({ email, password });
      showToast('success', 'Welcome Back', 'Successfully signed into ONYX.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!name.trim()) {
      setErrorMsg('Full name is required.');
      return;
    }
    if (!email.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      await signup({ name, email, password, confirmPassword });
      showToast('success', 'Account Created', 'Welcome to ONYX! Let’s configure your workspace.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Signup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!email || !email.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.forgotPassword(email);
      setSuccessMsg(res.message);
      if (res.resetToken) {
        setGeneratedResetToken(res.resetToken);
        setResetToken(res.resetToken);
        setTokenInput(res.resetToken);
      }
      showToast('info', 'Reset Token Generated', 'Use the generated security token to reset your password.');
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to request password reset.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    resetMessages();
    if (!tokenInput.trim()) {
      setErrorMsg('Security reset token is required.');
      return;
    }
    if (newPassword.length < 8) {
      setErrorMsg('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    setIsLoading(true);
    try {
      const res = await api.resetPassword({
        token: tokenInput.trim(),
        newPassword,
        confirmPassword: confirmNewPassword,
      });
      setSuccessMsg(res.message);
      showToast('success', 'Password Updated', 'You may now sign in with your new credentials.');
      setTimeout(() => {
        setAuthView('login');
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to reset password.');
    } finally {
      setIsLoading(false);
    }
  };

  const fillDemoAccount = () => {
    setEmail('researcher@onyx.ai');
    setPassword('OnyxWorkspace2026!');
  };

  return (
    <div className="min-h-screen w-full bg-[#080A0A] flex items-center justify-center p-4 sm:p-6 lg:p-8 relative overflow-hidden font-sans select-none">
      {/* Subtle Background Glows */}
      <div className="absolute top-1/4 -left-20 w-96 h-96 bg-[#D6C7A1]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-[#78C6A3]/5 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md relative z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#171C1A] border border-[#2A302D] text-[#D6C7A1] shadow-md mb-4">
            <Brain className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold text-[#F3F1EA] tracking-tight">
            ONYX
          </h1>
          <p className="text-xs text-[#929892] mt-1.5 font-medium tracking-wide">
            {authView === 'login' && 'Welcome to ONYX'}
            {authView === 'signup' && 'Create your ONYX account'}
            {authView === 'forgot-password' && 'Reset your ONYX password'}
            {authView === 'reset-password' && 'Set a new password for your account'}
          </p>
        </div>

        {/* Auth Card Container */}
        <div className="rounded-2xl bg-[#101413] border border-[#2A302D] shadow-2xl p-6 sm:p-8 space-y-6">
          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-3 text-xs text-red-400">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {/* Success Banner */}
          {successMsg && (
            <div className="p-3.5 rounded-xl bg-[#78C6A3]/10 border border-[#78C6A3]/30 flex items-start gap-3 text-xs text-[#78C6A3]">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div className="flex-1">{successMsg}</div>
            </div>
          )}

          {/* 1. LOGIN VIEW */}
          {authView === 'login' && (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      resetMessages();
                      setAuthView('forgot-password');
                    }}
                    className="text-[11px] text-[#929892] hover:text-[#D6C7A1] transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-login-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <Button
                id="btn-submit-login"
                type="submit"
                variant="champagne"
                size="md"
                loading={isLoading}
                className="w-full mt-2"
                icon={<ArrowRight className="w-4 h-4" />}
              >
                Sign In to Workspace
              </Button>

              {/* Demo Fill Helper */}
              <div className="pt-2 border-t border-[#2A302D]/60 flex items-center justify-between">
                <span className="text-[11px] text-[#626863]">Need quick test credentials?</span>
                <button
                  type="button"
                  onClick={fillDemoAccount}
                  className="text-[11px] text-[#78C6A3] hover:underline font-medium"
                >
                  Fill Sample User
                </button>
              </div>
            </form>
          )}

          {/* 2. SIGNUP VIEW */}
          {authView === 'signup' && (
            <form onSubmit={handleSignupSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Full Name
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-signup-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Dr. Alex Morgan"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-signup-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex@research.org"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Password (min 8 chars)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-signup-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-signup-confirm-password"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <Button
                id="btn-submit-signup"
                type="submit"
                variant="champagne"
                size="md"
                loading={isLoading}
                className="w-full mt-2"
                icon={<ArrowRight className="w-4 h-4" />}
              >
                Create Knowledge Workspace
              </Button>
            </form>
          )}

          {/* 3. FORGOT PASSWORD VIEW */}
          {authView === 'forgot-password' && (
            <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Registered Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-forgot-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              {generatedResetToken && (
                <div className="p-4 rounded-xl bg-[#171C1A] border border-[#D6C7A1]/40 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#D6C7A1]">
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Generated One-Time Reset Token</span>
                  </div>
                  <div className="font-mono text-xs text-[#F3F1EA] bg-[#101413] p-2.5 rounded-lg border border-[#2A302D] break-all select-all">
                    {generatedResetToken}
                  </div>
                  <Button
                    type="button"
                    variant="emerald"
                    size="sm"
                    className="w-full mt-2"
                    onClick={() => {
                      resetMessages();
                      setAuthView('reset-password');
                    }}
                  >
                    Proceed to Reset Form
                  </Button>
                </div>
              )}

              {!generatedResetToken && (
                <Button
                  id="btn-submit-forgot"
                  type="submit"
                  variant="champagne"
                  size="md"
                  loading={isLoading}
                  className="w-full mt-2"
                  icon={<KeyRound className="w-4 h-4" />}
                >
                  Generate Reset Token
                </Button>
              )}
            </form>
          )}

          {/* 4. RESET PASSWORD VIEW */}
          {authView === 'reset-password' && (
            <form onSubmit={handleResetPasswordSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Security Reset Token
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-reset-token"
                    type="text"
                    required
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Enter security token"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs font-mono text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  New Password (min 8 chars)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-reset-new-password"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-[#D6C7A1] uppercase tracking-wider">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#929892] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="input-reset-confirm-password"
                    type="password"
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#171C1A] border border-[#2A302D] focus:border-[#D6C7A1] text-xs text-[#F3F1EA] placeholder-[#626863] outline-none transition-colors"
                  />
                </div>
              </div>

              <Button
                id="btn-submit-reset-pw"
                type="submit"
                variant="champagne"
                size="md"
                loading={isLoading}
                className="w-full mt-2"
                icon={<CheckCircle2 className="w-4 h-4" />}
              >
                Update Password & Sign In
              </Button>
            </form>
          )}

          {/* Bottom Switch Links */}
          <div className="text-center pt-2 border-t border-[#2A302D]">
            {authView === 'login' && (
              <p className="text-xs text-[#929892]">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setAuthView('signup');
                  }}
                  className="text-[#D6C7A1] hover:underline font-semibold"
                >
                  Create Workspace
                </button>
              </p>
            )}

            {(authView === 'signup' || authView === 'forgot-password' || authView === 'reset-password') && (
              <p className="text-xs text-[#929892]">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => {
                    resetMessages();
                    setAuthView('login');
                  }}
                  className="text-[#D6C7A1] hover:underline font-semibold"
                >
                  Sign In
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Security Assurance Footer */}
        <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-[#626863]">
          <ShieldCheck className="w-3.5 h-3.5 text-[#78C6A3]" />
          <span>Multi-tenant data isolation with AES-256-GCM encrypted credentials</span>
        </div>
      </div>
    </div>
  );
};
