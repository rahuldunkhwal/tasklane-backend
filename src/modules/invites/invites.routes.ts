import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import * as invitesController from './invites.controller.js';

export const invitesRouter = Router();

// Public: anyone opening an invite link can see the board title + who invited them.
invitesRouter.get('/:token', invitesController.info);
// Logged-in only: actually join the board.
invitesRouter.post('/:token/accept', requireAuth, invitesController.accept);
