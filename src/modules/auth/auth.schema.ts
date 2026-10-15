import { z } from 'zod';

// "is required" when the field is missing or null, "must be text" when it's another type (e.g. an object)
function requiredString(field: string) {
  return z.string({
    error: (issue) =>
      issue.input === undefined || issue.input === null
        ? `${field} is required`
        : `${field} must be text`,
  });
}

const nameRule = requiredString('Name')
  .trim()
  .min(1, 'Name is required')
  .max(50, 'Name must be at most 50 characters');

// Trim and lowercase first, then check the format.
// abort: true = if the field is empty, stop here and show only "is required" (not a format error too).
const emailRule = requiredString('Email')
  .trim()
  .toLowerCase()
  .min(1, { error: 'Email is required', abort: true })
  .pipe(z.email('Enter a valid email address'));

// Exported: reset password and change password (later phases) must use the same rules
export const passwordRule = requiredString('Password')
  .min(1, { error: 'Password is required', abort: true })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters') // bcrypt ignores anything after 72 bytes
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const signupSchema = z.object({
  name: nameRule,
  email: emailRule,
  password: passwordRule,
});

// Login only checks that a password was typed: strength rules apply when a password is
// created, not when it's used (otherwise users with older, weaker passwords couldn't log in).
export const loginSchema = z.object({
  email: emailRule,
  password: requiredString('Password').min(1, 'Password is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
