import type { Request, RequestHandler } from 'express';
import { findActiveSession } from '../modules/auth/auth.service.js';
import { AUTH_COOKIE, verifyAuthToken } from '../modules/auth/auth.token.js';
import { UserModel, type UserDocument } from '../modules/users/user.model.js';
import { AppError } from '../utils/AppError.js';

function unauthorized() {
  return new AppError(401, 'UNAUTHORIZED', 'Please log in to continue');
}

// Put this in front of any route that needs a logged-in user. Each check below can fail with 401:
//   1. cookie present?   2. token genuine and not expired?   3. session still active (not logged out)?
//   4. user still exists (not deleted)?
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies[AUTH_COOKIE];
  const payload = typeof token === 'string' ? verifyAuthToken(token) : null;
  if (!payload) throw unauthorized();

  const session = await findActiveSession(payload);
  if (!session) throw unauthorized();

  const user = await UserModel.findById(payload.userId);
  if (!user) throw unauthorized();

  req.user = user;
  req.sessionId = session.id;
  next();
};

// For handlers behind requireAuth: returns the logged-in user with a non-optional type
export function getAuthUser(req: Request): UserDocument {
  if (!req.user) throw unauthorized();
  return req.user;
}

// For handlers behind requireAuth: the id of the session (device) making this request
export function getAuthSessionId(req: Request): string {
  if (!req.sessionId) throw unauthorized();
  return req.sessionId;
}
