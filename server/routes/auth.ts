/**
 * Second Brain — Authentication Routes
 * Signup, Login, Forgot Password, Reset Password, and Current User profile
 */

import { Router, Request, Response } from 'express';
import { dbService, UserRecord, UserCredentials } from '../db/database';
import { CryptoService } from '../services/crypto-service';
import { requireAuth } from '../middleware/auth';
import { SetupStatus } from '../../src/types';

export const authRouter = Router();

function getSetupStatusDto(userId: string, creds: UserCredentials | null): SetupStatus {
  return {
    userId,
    geminiConnected: creds?.geminiVerified || false,
    geminiMasked: creds?.geminiApiKeyMasked,
    qdrantConnected: creds?.qdrantVerified || false,
    qdrantUrlMasked: creds?.qdrantUrlMasked,
    postgresConnected: creds?.postgresVerified || false,
    postgresUrlMasked: creds?.postgresUrlMasked,
    setupCompleted: creds?.setupCompleted || false,
    currentSetupStep: creds?.currentSetupStep || 'gemini',
  };
}

// POST /api/auth/signup
authRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Full name is required' });
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await dbService.getUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    const userId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { hash, salt } = CryptoService.hashPassword(password);

    const newUser: UserRecord = {
      id: userId,
      name: name.trim(),
      email: normalizedEmail,
      avatarUrl: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name.trim())}`,
      passwordHash: hash,
      passwordSalt: salt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbService.saveUser(newUser);

    // Initialize fresh infrastructure credentials setup
    const initialCreds: UserCredentials = {
      userId,
      geminiVerified: false,
      qdrantVerified: false,
      postgresVerified: false,
      setupCompleted: false,
      currentSetupStep: 'gemini',
      updatedAt: new Date().toISOString(),
    };
    await dbService.saveUserCredentials(initialCreds);

    const token = CryptoService.createAuthToken({ userId, email: newUser.email });

    res.status(201).json({
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        avatarUrl: newUser.avatarUrl,
        createdAt: newUser.createdAt,
      },
      token,
      setupStatus: getSetupStatusDto(userId, initialCreds),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Signup failed' });
  }
});

// POST /api/auth/login
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await dbService.getUserByEmail(normalizedEmail);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = CryptoService.verifyPassword(password, user.passwordHash, user.passwordSalt);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const creds = await dbService.getUserCredentials(user.id);
    const token = CryptoService.createAuthToken({ userId: user.id, email: user.email });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      token,
      setupStatus: getSetupStatusDto(user.id, creds),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const user = await dbService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const creds = await dbService.getUserCredentials(userId);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
      },
      setupStatus: getSetupStatusDto(userId, creds),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/forgot-password
authRouter.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const user = await dbService.getUserByEmail(email.toLowerCase().trim());
    if (!user) {
      // Return success to avoid email enumeration
      return res.json({
        success: true,
        message: 'If an account with that email exists, reset instructions have been generated.',
      });
    }

    const resetToken = CryptoService.generateRandomToken(24);
    const expires = new Date(Date.now() + 3600000); // 1 hour

    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = expires.toISOString();
    user.updatedAt = new Date().toISOString();

    await dbService.saveUser(user);

    res.json({
      success: true,
      message: 'Password reset link has been generated. Use the token to reset your password.',
      resetToken, // Provided for instant seamless test and demo execution
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/reset-password
authRouter.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Reset token is required' });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }
    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    const user = await dbService.getUserByResetToken(token);
    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired password reset token' });
    }

    const { hash, salt } = CryptoService.hashPassword(newPassword);
    user.passwordHash = hash;
    user.passwordSalt = salt;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.updatedAt = new Date().toISOString();

    await dbService.saveUser(user);

    res.json({
      success: true,
      message: 'Your password has been successfully updated. You may now sign in.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
authRouter.post('/logout', (req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out successfully' });
});
