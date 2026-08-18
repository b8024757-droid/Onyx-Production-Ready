import { dbService } from './database';

// Export dbService as memoryStore for backwards compatibility with existing references
export const memoryStore = dbService;
