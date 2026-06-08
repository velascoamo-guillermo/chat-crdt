import { z } from 'zod';

/**
 * Validated environment schema. Fails fast at boot so the server never starts
 * with a missing/weak JWT_SECRET or an unset DATABASE_URL.
 */
const envSchema = z.object({
  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET is required' })
    .min(16, 'JWT_SECRET must be at least 16 characters'),
  DATABASE_URL: z.string({ required_error: 'DATABASE_URL is required' }).url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  CORS_ORIGIN: z.string().default('http://localhost:8081'),
  PORT: z.coerce.number().int().positive().default(3001),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
