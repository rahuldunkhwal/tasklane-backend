import { Router } from 'express';
import { healthRouter } from '../modules/health/health.routes.js';

// Every feature router is mounted here, so app.ts stays short.
// Later: apiRouter.use('/auth', authRouter), apiRouter.use('/boards', boardsRouter), ...
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
