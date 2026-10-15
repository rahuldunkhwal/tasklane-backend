import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';

// Builds the Express app without starting it, so tests can pass it straight to supertest.
export function createApp() {
  const app = express();

  // Logger goes first so it sees every request, including CORS preflights
  // that cors() answers and ends before any later middleware runs.
  if (env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
  }

  // Security headers (no-sniff, frame-ancestors, HSTS, ...) and hides "X-Powered-By: Express"
  app.use(helmet());

  // Only our frontend may call the API from a browser; credentials: true allows the auth cookie
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  // Parse JSON bodies, capped at 100kb so a huge payload can't exhaust memory
  app.use(express.json({ limit: '100kb' }));

  return app;
}
