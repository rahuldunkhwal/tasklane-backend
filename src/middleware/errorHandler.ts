import type { ErrorRequestHandler } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { AppError, type ErrorDetail } from '../utils/AppError.js';

type ErrorBody = { error: { code: string; message: string; details?: ErrorDetail[] } };

// Errors created by express.json() carry a `type` and an HTTP `status`
function isHttpError(err: unknown): err is { type?: string; status: number; message: string } {
  return (
    typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number'
  );
}

function reply(status: number, code: string, message: string, details?: ErrorDetail[]) {
  return { status, body: { error: { code, message, details } } satisfies ErrorBody };
}

// Decides what the client sees for each kind of error. Exported so tests can check it directly.
export function toErrorResponse(err: unknown) {
  // 1. Errors we threw on purpose
  if (err instanceof AppError) {
    return reply(err.statusCode, err.code, err.message, err.details);
  }

  // 1b. A file upload (multer) was rejected — most often too large
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return reply(413, 'PAYLOAD_TOO_LARGE', 'The image is too large (max 2 MB)');
    }
    return reply(400, 'INVALID_UPLOAD', err.message);
  }

  // 2. Request validation failed (zod schemas)
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));
    return reply(400, 'VALIDATION_ERROR', 'Invalid request data', details);
  }

  // 3. A value could not be converted for a query, e.g. "abc" used as an ObjectId
  if (err instanceof mongoose.Error.CastError) {
    // "_id" is a database name: show users a plain "Invalid id"
    return reply(400, 'INVALID_ID', err.path === '_id' ? 'Invalid id' : `Invalid ${err.path}`);
  }

  // 4. A document broke a rule in its Mongoose schema
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    return reply(400, 'VALIDATION_ERROR', 'Invalid data', details);
  }

  // 5. A unique index rejected a duplicate (e.g. two signups with the same email at the same moment)
  if (err instanceof mongoose.mongo.MongoServerError && err.code === 11000) {
    return reply(409, 'CONFLICT', 'A record with this value already exists');
  }

  // 6. Problems with the request body itself, detected by express.json()
  if (isHttpError(err)) {
    if (err.type === 'entity.parse.failed') {
      return reply(400, 'INVALID_JSON', 'Request body is not valid JSON');
    }
    if (err.type === 'entity.too.large') {
      return reply(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    }
    if (err.status >= 400 && err.status < 500) {
      return reply(err.status, 'BAD_REQUEST', err.message);
    }
  }

  // 7. Anything else is a bug on our side: never show internal details to the client
  return reply(500, 'INTERNAL_ERROR', 'Something went wrong');
}

// Express recognises an error handler by its FOUR parameters (err, req, res, next).
// With only three, Express would treat it as a normal middleware and never send errors to it.
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // If the response was already partly sent, we can't send JSON anymore: let Express close it
  if (res.headersSent) {
    next(err);
    return;
  }

  const { status, body } = toErrorResponse(err);

  // Unexpected errors: log the full error (with stack trace) for us, the client only gets the generic message
  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json(body);
};
