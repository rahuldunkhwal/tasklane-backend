import { Router } from 'express';
import { isDbConnected } from '../../config/db.js';

export const healthRouter = Router();

// Used by us and by the hosting platform to check "is this server able to do its job?"
healthRouter.get('/', (_req, res) => {
  const dbUp = isDbConnected();

  // 503 = "temporarily unable to serve": the process is alive but the database is not reachable
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    db: dbUp ? 'up' : 'down',
    uptimeSeconds: Math.round(process.uptime()),
  });
});
