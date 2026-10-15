import type { RequestHandler } from 'express';
import { getAuthUser } from '../../middleware/requireAuth.js';
import { AppError } from '../../utils/AppError.js';
import * as usersService from './users.service.js';
import type { UpdateNameInput } from './users.schema.js';

export const updateMe: RequestHandler = async (req, res) => {
  const user = await usersService.updateName(getAuthUser(req).id, req.body as UpdateNameInput);
  res.json({ user });
};

export const uploadAvatar: RequestHandler = async (req, res) => {
  if (!req.file) throw new AppError(400, 'NO_FILE', 'No image was uploaded');
  const user = await usersService.uploadAvatar(getAuthUser(req).id, req.file);
  res.json({ user });
};

export const removeAvatar: RequestHandler = async (req, res) => {
  const user = await usersService.removeAvatar(getAuthUser(req).id);
  res.json({ user });
};
