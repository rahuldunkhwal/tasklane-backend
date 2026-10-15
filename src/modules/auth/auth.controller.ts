import type { RequestHandler } from 'express';
import { getAuthUser } from '../../middleware/requireAuth.js';
import { toPublicUser } from '../users/user.dto.js';
import type { LoginInput, SignupInput } from './auth.schema.js';
import * as authService from './auth.service.js';
import { AUTH_COOKIE, clearAuthCookie, setAuthCookie } from './auth.token.js';

// Controllers only deal with HTTP: read the request, call the service, send the response.
// The `as` casts are safe: validateBody() already checked and cleaned req.body.

export const signup: RequestHandler = async (req, res) => {
  const user = await authService.signup(req.body as SignupInput);
  // Signing up logs the user in straight away
  setAuthCookie(res, await authService.startSession(user.id));
  res.status(201).json({ user: toPublicUser(user) });
};

export const login: RequestHandler = async (req, res) => {
  const user = await authService.login(req.body as LoginInput);
  setAuthCookie(res, await authService.startSession(user.id));
  res.json({ user: toPublicUser(user) });
};

// The frontend calls this on page load to find out who is logged in (it can't read the httpOnly cookie)
export const me: RequestHandler = (req, res) => {
  res.json({ user: toPublicUser(getAuthUser(req)) });
};

export const logout: RequestHandler = async (req, res) => {
  const token: unknown = req.cookies[AUTH_COOKIE];
  await authService.endSession(typeof token === 'string' ? token : undefined);
  clearAuthCookie(res);
  res.status(204).end(); // 204 = success, nothing to send back
};
