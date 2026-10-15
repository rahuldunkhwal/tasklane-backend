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
