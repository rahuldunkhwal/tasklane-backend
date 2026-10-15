import type { UserDocument } from '../modules/users/user.model.js';

// Teaches TypeScript that requireAuth adds these two fields to every request it lets through
declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
      sessionId?: string;
    }
  }
}

export {};
