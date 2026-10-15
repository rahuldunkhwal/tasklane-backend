import { z } from 'zod';

// A required text field with clear messages:
// "<Field> is required" when it's missing or null, "<Field> must be text" for any other type (e.g. an object).
export function requiredString(field: string) {
  return z.string({
    error: (issue) =>
      issue.input === undefined || issue.input === null
        ? `${field} is required`
        : `${field} must be text`,
  });
}

// Used by signup, login, forgot password and board sharing.
// Trim and lowercase first, then check the format.
// abort: true = if the field is empty, stop here and show only "is required" (not a format error too).
export const emailRule = requiredString('Email')
  .trim()
  .toLowerCase()
  .min(1, { error: 'Email is required', abort: true })
  .pipe(z.email('Enter a valid email address'));
