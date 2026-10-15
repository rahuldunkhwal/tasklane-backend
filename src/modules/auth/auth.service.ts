import { AppError } from '../../utils/AppError.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { UserModel } from '../users/user.model.js';
import type { LoginInput, SignupInput } from './auth.schema.js';
import {
  SESSION_SECONDS,
  signAuthToken,
  verifyAuthToken,
  type TokenPayload,
} from './auth.token.js';
import { SessionModel } from './session.model.js';

// Services hold the business logic. They never touch req/res, so they're easy to reuse and reason about.

export async function signup(input: SignupInput) {
  const emailTaken = await UserModel.exists({ email: input.email });
  if (emailTaken) {
    throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);

  // If two signups with the same email race past the check above, the unique index
  // rejects the second insert and the error handler returns 409 CONFLICT.
  return UserModel.create({ name: input.name, email: input.email, passwordHash });
}

export async function login(input: LoginInput) {
  // passwordHash has select: false in the schema, so we must ask for it explicitly here
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash');

  // Same error for "no account with this email" and "wrong password",
  // so the response never reveals which emails are registered.
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  return user;
}

// Creates a DB session for this login and returns a signed token pointing to it
export async function startSession(userId: string) {
  const session = await SessionModel.create({
    user: userId,
    expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000),
  });
  return signAuthToken({ userId, sessionId: session.id });
}

// A session counts only if it exists, belongs to this user, and hasn't expired.
// (The TTL index deletes expired sessions, but only checks about once a minute.)
export function findActiveSession({ userId, sessionId }: TokenPayload) {
  return SessionModel.findOne({ _id: sessionId, user: userId, expiresAt: { $gt: new Date() } });
}

// Logout: delete the session the token points to. A missing or invalid token is not an error,
// so logging out twice (or with an expired cookie) still succeeds.
export async function endSession(token: string | undefined) {
  const payload = token ? verifyAuthToken(token) : null;
  if (payload) {
    await SessionModel.deleteOne({ _id: payload.sessionId, user: payload.userId });
  }
}
