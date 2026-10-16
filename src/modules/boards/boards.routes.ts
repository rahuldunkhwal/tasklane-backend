import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validateBody } from '../../middleware/validate.js';
import * as boardsController from './boards.controller.js';
import { createBoardSchema, shareBoardSchema, updateBoardSchema } from './boards.schema.js';

export const boardsRouter = Router();

// Every board route needs a logged-in user: one line protects them all
boardsRouter.use(requireAuth);

boardsRouter.get('/', boardsController.list);
boardsRouter.post('/', validateBody(createBoardSchema), boardsController.create);
boardsRouter.get('/:id', boardsController.getOne);
boardsRouter.patch('/:id', validateBody(updateBoardSchema), boardsController.update);
boardsRouter.delete('/:id', boardsController.remove);

// Sharing (owner only: viewers get 403, strangers 404)
boardsRouter.get('/:id/shares', boardsController.sharing);
boardsRouter.post('/:id/shares', validateBody(shareBoardSchema), boardsController.share);
boardsRouter.delete('/:id/shares/:userId', boardsController.unshare);
// Share with an email: instant access if it has an account, otherwise an emailed invite bound
// to that address. DELETE withdraws a pending invite.
boardsRouter.post('/:id/invites', validateBody(shareBoardSchema), boardsController.sendInvite);
boardsRouter.delete('/:id/invites/:email', boardsController.removeInvite);
// Regenerate the invite link, disabling the old one
boardsRouter.post('/:id/invite-link/reset', boardsController.resetInviteLink);
