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
  CLIENT_ORIGIN: z.url().default('http://localhost:5173'),
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
