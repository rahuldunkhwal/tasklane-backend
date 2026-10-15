import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { AppError } from '../utils/AppError.js';

// Checks req.body against a zod schema BEFORE the controller runs.
// Valid:   req.body is replaced with the cleaned data (trimmed, lowercased, unknown fields removed).
// Invalid: zod throws a ZodError → the error handler replies 400 VALIDATION_ERROR with per-field details.
export function validateBody(schema: ZodType): RequestHandler {
  return (req, _res, next) => {
    // No body at all, an array, or data sent without "Content-Type: application/json"
    const isJsonObject =
      typeof req.body === 'object' && req.body !== null && !Array.isArray(req.body);
    if (!isJsonObject) {
      throw new AppError(400, 'INVALID_BODY', 'Request body must be a JSON object');
    }

    req.body = schema.parse(req.body);
    next();
  };
}
