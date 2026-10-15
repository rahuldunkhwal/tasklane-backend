import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';
import { sendEmail } from '../../utils/email.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { UserModel } from '../users/user.model.js';
import { passwordResetEmail } from './auth.emails.js';
import type { LoginInput, ResetPasswordInput, SignupInput } from './auth.schema.js';
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

// ---------- Forgot / reset password ----------

const RESET_TOKEN_MINUTES = 15;

// SHA-256 is enough here (no bcrypt needed): the token is 32 random bytes, far too many
// possibilities to guess, and a plain hash lets us look the user up by it.
function hashResetToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function requestPasswordReset(email: string) {
  const user = await UserModel.findOne({ email });

  // Unknown email: do nothing, but the controller sends the SAME response,
  // so this endpoint can't be used to find out who has an account.
  if (!user) return;

  // A new request replaces any older token, so only the latest link works
  const token = crypto.randomBytes(32).toString('hex');
  await UserModel.updateOne(
    { _id: user._id },
    {
      passwordResetTokenHash: hashResetToken(token),
      passwordResetExpires: new Date(Date.now() + RESET_TOKEN_MINUTES * 60 * 1000),
    },
  );

  // The link opens the frontend's reset page, which sends the token back to /reset-password
  const link = `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;

  // Not awaited on purpose: waiting for the email provider would make the response slower
  // only for registered emails (that timing difference would reveal them), and a failing
  // provider must not change the response either. Failures are logged (never the token).
  sendEmail(passwordResetEmail(user.email, link, RESET_TOKEN_MINUTES)).catch((error: unknown) => {
    console.error('Failed to send password reset email:', error);
  });
}

export async function resetPassword({ token, password }: ResetPasswordInput) {
  const passwordHash = await hashPassword(password);

  // ONE atomic update: it only matches if the token is valid and not expired, and in the same
  // step it sets the new password and removes the token. So the link works exactly once,
  // even if it's submitted twice at the same moment.
  const user = await UserModel.findOneAndUpdate(
    { passwordResetTokenHash: hashResetToken(token), passwordResetExpires: { $gt: new Date() } },
    { $set: { passwordHash }, $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } },
  );
  if (!user) {
    throw new AppError(400, 'INVALID_RESET_TOKEN', 'This reset link is invalid or has expired');
  }

  // Log out every device: anyone who knew the old password loses access
  await SessionModel.deleteMany({ user: user._id });
}
