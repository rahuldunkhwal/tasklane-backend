import { config } from 'dotenv';
import { z } from 'zod';

// Copy variables from .env into process.env (in production the host sets them instead,
// and a missing .env file is fine because dotenv does not overwrite existing variables).
config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z
    .string({ error: 'is required' })
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  // The frontend's origin. Drives CORS AND the links in emails/invites (reset + invite links).
  // In production set it to the deployed frontend URL. A trailing slash is stripped so links
  // never come out as "https://app.com//invite/...".
  CLIENT_ORIGIN: z
    .url()
    .default('http://localhost:5173')
    .transform((value) => value.replace(/\/+$/, '')),
  // Signs login tokens. Anyone who knows it can create a valid token for any user, so it must be long and random.
  JWT_SECRET: z
    .string({ error: 'is required' })
    .min(32, 'must be at least 32 characters (generate a random one)'),
  // Optional in development: without a key, emails are printed in the terminal instead of sent
  SENDGRID_API_KEY: z.string().optional(),
  // SendGrid "Single Sender" only delivers from a verified address, so this MUST match
  // the exact sender email you verified in SendGrid (e.g. your own Gmail).
  MAIL_FROM: z.string().default('Task Board <your-verified-sender@example.com>'),
});

const parsed = envSchema.safeParse(process.env);

// Fail fast: refuse to boot with a clear list of problems,
// instead of crashing later on the first request that needs a missing value.
if (!parsed.success) {
  console.error('Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
