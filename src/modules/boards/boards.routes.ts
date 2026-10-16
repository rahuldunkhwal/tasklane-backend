import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validateBody } from '../../middleware/validate.js';
import * as boardsController from './boards.controller.js';
import { createBoardSchema, inviteSchema, updateBoardSchema } from './boards.schema.js';

export const boardsRouter = Router();

// Every board route needs a logged-in user: one line protects them all
boardsRouter.use(requireAuth);

boardsRouter.get('/', boardsController.list);
boardsRouter.post('/', validateBody(createBoardSchema), boardsController.create);
boardsRouter.get('/:id', boardsController.getOne);
boardsRouter.patch('/:id', validateBody(updateBoardSchema), boardsController.update);
boardsRouter.delete('/:id', boardsController.remove);

// Sharing (owner only: viewers get 403, strangers 404). Access is only ever granted when the
// invited person accepts the emailed invite (see /api/invites); the owner can revoke it here.
boardsRouter.get('/:id/shares', boardsController.sharing);
boardsRouter.delete('/:id/shares/:userId', boardsController.unshare);
boardsRouter.post('/:id/invites', validateBody(inviteSchema), boardsController.sendInvite);
boardsRouter.delete('/:id/invites/:email', boardsController.removeInvite);
