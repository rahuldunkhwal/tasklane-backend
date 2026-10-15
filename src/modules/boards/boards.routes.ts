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
boardsRouter.get('/:id/shares', boardsController.listShares);
boardsRouter.post('/:id/shares', validateBody(shareBoardSchema), boardsController.share);
boardsRouter.delete('/:id/shares/:userId', boardsController.unshare);
