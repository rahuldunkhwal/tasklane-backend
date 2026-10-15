import { z } from 'zod';
import { requiredString } from '../../utils/zod.js';

const titleRule = requiredString('Title')
  .trim()
  .min(1, 'Title is required')
  .max(100, 'Title must be at most 100 characters');

// Only "title" is accepted: any other field (e.g. "owner") is dropped by zod,
// so nobody can create or move a board into another user's account.
export const createBoardSchema = z.object({ title: titleRule });
export const updateBoardSchema = z.object({ title: titleRule });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
