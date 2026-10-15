import { Router } from 'express';
import { requireAuth } from '../../middleware/requireAuth.js';
import { validateBody } from '../../middleware/validate.js';
import * as tasksController from './tasks.controller.js';
import { createTaskSchema, updateTaskSchema } from './tasks.schema.js';

export const tasksRouter = Router();

tasksRouter.use(requireAuth);

tasksRouter.get('/', tasksController.list);
tasksRouter.post('/', validateBody(createTaskSchema), tasksController.create);
tasksRouter.patch('/:id', validateBody(updateTaskSchema), tasksController.update);
tasksRouter.delete('/:id', tasksController.remove);
