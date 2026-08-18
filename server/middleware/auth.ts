import { Request, Response, NextFunction } from 'express';
import { CryptoService } from '../services/crypto-service';
import { dbService } from '../db/database';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
    let token = '';

    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'Authentication token is required' });
    }

    const payload = CryptoService.verifyAuthToken<{ userId: string; email: string }>(token);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'Invalid or expired authentication token' });
    }

    const user = await dbService.getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'User account not found' });
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };

    next();
  } catch (err: any) {
    res.status(401).json({ error: 'Authentication failed: ' + err.message });
  }
};

export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
    let token = '';

    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
      } else {
        token = authHeader.trim();
      }
    }

    if (token) {
      const payload = CryptoService.verifyAuthToken<{ userId: string; email: string }>(token);
      if (payload && payload.userId) {
        const user = await dbService.getUserById(payload.userId);
        if (user) {
          req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
          };
        }
      }
    }
  } catch {
    // Ignore error in optional auth
  }
  next();
};
