import { AppError } from '../../utils/AppError.js';
import { hashPassword } from '../../utils/password.js';
import { UserModel } from '../users/user.model.js';
import type { SignupInput } from './auth.schema.js';

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
