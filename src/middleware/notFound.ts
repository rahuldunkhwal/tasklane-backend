import type { RequestHandler } from 'express';
import { AppError } from '../utils/AppError.js';

// Registered after all routes, so it only runs when nothing matched.
// It doesn't reply itself: it hands a 404 error to the error handler, which formats every error.
export const notFound: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route not found: ${req.method} ${req.originalUrl}`));
};
