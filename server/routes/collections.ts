import { Router, Request, Response } from 'express';
import { dbService } from '../db/database';
import { optionalAuth } from '../middleware/auth';
import { Collection } from '../../src/types';

export const collectionsRouter = Router();

// Enable user context resolution
collectionsRouter.use(optionalAuth);

// GET /api/collections
collectionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const collections = await dbService.getCollections(userId);
    res.json({ collections });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/collections/:id
collectionsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const col = await dbService.getCollectionById(req.params.id, userId);
    if (!col) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    const allDocs = await dbService.getDocuments(userId);
    const documents = allDocs.filter(d => d.collectionId === col.id);
    res.json({ collection: col, documents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/collections
collectionsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const { name, description, tags } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    const newCol: Collection = {
      id: `col-${Date.now()}`,
      userId,
      name,
      description: description || '',
      documentCount: 0,
      tags: tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await dbService.saveCollection(newCol);
    dbService.addActivity({
      id: `act-${Date.now()}`,
      userId,
      type: 'collection_created',
      title: 'Collection Created',
      description: `Created new knowledge collection: "${name}"`,
      timestamp: new Date().toISOString(),
    });

    dbService.addNotification({
      id: `notif-col-${newCol.id}`,
      userId,
      type: 'SUCCESS',
      title: 'Collection Created',
      message: `Created collection "${name}"`,
      timestamp: new Date().toISOString(),
      read: false,
      collectionId: newCol.id,
      linkTab: 'collections',
    });

    res.status(201).json({ collection: newCol });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/collections/:id
collectionsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id || 'user-default-admin';
    const success = await dbService.deleteCollection(req.params.id, userId);
    if (!success) {
      return res.status(404).json({ error: 'Collection not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
