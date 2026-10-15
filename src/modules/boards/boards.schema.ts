import { z } from 'zod';
import { emailRule, requiredString } from '../../utils/zod.js';

const titleRule = requiredString('Title')
  .trim()
  .min(1, 'Title is required')
  .max(100, 'Title must be at most 100 characters');

// Only "title" is accepted: any other field (e.g. "owner") is dropped by zod,
// so nobody can create or move a board into another user's account.
export const createBoardSchema = z.object({ title: titleRule });
export const updateBoardSchema = z.object({ title: titleRule });

// Share by email (trimmed + lowercased, so "Bob@Mail.com" finds bob@mail.com)
export const shareBoardSchema = z.object({ email: emailRule });

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
export type ShareBoardInput = z.infer<typeof shareBoardSchema>;
