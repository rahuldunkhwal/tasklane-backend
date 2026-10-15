import { Router } from 'express';
import { healthRouter } from '../modules/health/health.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { boardsRouter } from '../modules/boards/boards.routes.js';
import { tasksRouter } from '../modules/tasks/tasks.routes.js';

// Every feature router is mounted here, so app.ts stays short.
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/boards', boardsRouter);
apiRouter.use('/tasks', tasksRouter);
