import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';

export const AUTH_COOKIE = 'token';

// One constant drives the token expiry, the cookie lifetime and the DB session expiry
export const SESSION_SECONDS = 7 * 24 * 60 * 60; // 7 days

const cookieOptions: CookieOptions = {
  httpOnly: true, // browser JavaScript can't read it, so an XSS bug can't steal the token
  secure: env.NODE_ENV === 'production', // only sent over HTTPS in production (localhost is plain HTTP)
  sameSite: 'lax', // not sent with POST/PUT/DELETE requests that start on another site (CSRF protection)
  path: '/',
};

export type TokenPayload = { userId: string; sessionId: string };

// The token holds only ids ("sub" = subject = user, "sid" = session). Its content is readable
// by anyone, so never put secrets in it: the signature only proves it wasn't changed.
export function signAuthToken({ userId, sessionId }: TokenPayload) {
  return jwt.sign({ sub: userId, sid: sessionId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: SESSION_SECONDS,
  });
}

// Returns the ids if the token is genuine and not expired, otherwise null
export function verifyAuthToken(token: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
    if (
      typeof payload === 'object' &&
      typeof payload.sub === 'string' &&
      typeof payload.sid === 'string'
    ) {
      return { userId: payload.sub, sessionId: payload.sid };
    }
    return null;
  } catch {
    return null; // bad signature, expired, or malformed
  }
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(AUTH_COOKIE, token, {
    ...cookieOptions,
    maxAge: SESSION_SECONDS * 1000, // cookie maxAge is in milliseconds
  });
}

// The browser only deletes a cookie if path/sameSite/secure match the ones it was set with
export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE, cookieOptions);
}
