import type { RequestHandler } from 'express';
import { getAuthUser } from '../../middleware/requireAuth.js';
import * as boardsService from '../boards/boards.service.js';

// What the invite landing page shows before anyone logs in (public, no auth).
export const info: RequestHandler<{ token: string }> = async (req, res) => {
  res.json(await boardsService.getInviteInfo(req.params.token));
};

// A logged-in user joins the board the link points to (as a viewer).
export const accept: RequestHandler<{ token: string }> = async (req, res) => {
  res.json(await boardsService.acceptInvite(getAuthUser(req).id, req.params.token));
};
