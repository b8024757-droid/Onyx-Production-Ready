import { Router, Request, Response } from 'express';
import { dbService } from '../db/database';
import { chatService } from '../services/chat-service';
import { optionalAuth } from '../middleware/auth';
import { Conversation } from '../../src/types';

export const chatRouter = Router();

// Enable user context resolution
chatRouter.use(optionalAuth);

// GET /api/chat/conversations
chatRouter.get('/conversations', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const conversations = await dbService.getConversations(userId);
    res.json({ conversations });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/conversations
chatRouter.post('/conversations', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { title, collectionScopeId } = req.body;
    const newConv: Conversation = {
      id: `conv-${Date.now()}`,
      userId,
      title: title || 'New Research Thread',
      messageCount: 0,
      collectionScopeId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbService.saveConversation(newConv);
    res.status(201).json({ conversation: newConv });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chat/conversations/:id/messages
chatRouter.get('/conversations/:id/messages', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const conv = await dbService.getConversationById(req.params.id, userId);
    if (!conv) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
    const messages = await dbService.getMessages(conv.id, userId);
    res.json({ conversation: conv, messages });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/chat/conversations/:id
chatRouter.delete('/conversations/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { id } = req.params;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Valid conversation ID is required' });
    }

    const conversation = await dbService.getConversationById(id, userId);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const deleted = await dbService.deleteConversation(id, userId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete conversation from database' });
    }

    res.json({ success: true, message: 'Conversation deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/chat/stream (SSE Streaming RAG)
chatRouter.post('/stream', async (req: Request, res: Response) => {
  const userId = req.user?.id || 'user-default-admin';
  const { conversationId, query, collectionScopeId } = req.body;

  if (!query) {
    return res.status(400).json({ error: 'Query is required' });
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await chatService.streamChatResponse(query, res, {
      conversationId,
      collectionId: collectionScopeId,
      userId,
    });
  } catch (error: any) {
    console.error('[ChatRoute] Stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
    res.end();
  }
});
