import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Repo root, resolved the same way from backend/src (tsx) and backend/dist (node). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** PayPal is sandbox-only for this project. This is a constant on purpose: there is no live switch. */
export const PAYPAL_API_BASE = 'https://api-m.sandbox.paypal.com';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const bool = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : String(v).toLowerCase() === 'true'),
    z.boolean(),
  );

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Loopback by default so a dev machine doesn't expose the API on the LAN. Render sets 0.0.0.0.
  HOST: z.string().default('127.0.0.1'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_PATH: z.string().default('data/fargain.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEV_ROUTES_ENABLED: bool(false),
  FARGAIN_API_TOKEN: optionalString,

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: optionalString,
  ANTHROPIC_VISION_MODEL: optionalString,

  PAYPAL_ENV: z.preprocess(emptyToUndefined, z.literal('sandbox').default('sandbox')),
  PAYPAL_CLIENT_ID: optionalString,
  PAYPAL_CLIENT_SECRET: optionalString,
  PAYPAL_WEBHOOK_ID: optionalString,
  PAYPAL_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),

  CHANNEL3_API_KEY: optionalString,
  /** Price watch job interval. 0 disables the job (manual refresh and the dev helper still work). */
  PRICE_WATCH_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(360),

  IG_APP_SECRET: optionalString,
  IG_VERIFY_TOKEN: optionalString,
  IG_ACCESS_TOKEN: optionalString,
  IG_ACCOUNT_ID: optionalString,
  /** Graph API version for Instagram messaging calls. Not hard-wired so it can follow Meta's releases. */
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v25.0'),
});
export type Env = z.infer<typeof EnvSchema>;

/** Keys whose values must never be printed or logged. */
export const SECRET_KEYS = [
  'FARGAIN_API_TOKEN',
  'ANTHROPIC_API_KEY',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'CHANNEL3_API_KEY',
  'IG_APP_SECRET',
  'IG_VERIFY_TOKEN',
  'IG_ACCESS_TOKEN',
  'IG_ACCOUNT_ID',
] as const satisfies readonly (keyof Env)[];

/** Feature groups and the env vars each one needs. Used by check-env and by features at call time. */
export const FEATURE_REQUIREMENTS = {
  llm: ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'],
  vision: ['ANTHROPIC_API_KEY', 'ANTHROPIC_VISION_MODEL'],
  paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  paypalWebhook: ['PAYPAL_WEBHOOK_ID'],
  channel3: ['CHANNEL3_API_KEY'],
  instagram: ['IG_APP_SECRET', 'IG_VERIFY_TOKEN', 'IG_ACCESS_TOKEN', 'IG_ACCOUNT_ID'],
  /** Receiving webhooks: verify handshake + check signatures. */
  instagramWebhook: ['IG_APP_SECRET', 'IG_VERIFY_TOKEN'],
  /** Replying in the DM (Page access token with instagram_manage_messages). */
  instagramSend: ['IG_ACCESS_TOKEN'],
} as const satisfies Record<string, readonly (keyof Env)[]>;
export type Feature = keyof typeof FEATURE_REQUIREMENTS;

export class MissingConfigError extends Error {
  constructor(
    public readonly feature: Feature,
    public readonly missing: string[],
  ) {
    super(`Feature "${feature}" is not configured. Missing env vars: ${missing.join(', ')}`);
    this.name = 'MissingConfigError';
  }
}

/** Load the repo-root .env (if present) into process.env. Existing process env wins. */
export function loadDotEnv(file = process.env.ENV_FILE ?? path.join(REPO_ROOT, '.env')): boolean {
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // Only report the offending key names and messages, never values.
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return result.data;
}

export function missingFor(env: Env, feature: Feature): string[] {
  return FEATURE_REQUIREMENTS[feature].filter((k) => env[k] === undefined);
}

export function requireFeature(env: Env, feature: Feature): void {
  const missing = missingFor(env, feature);
  if (missing.length > 0) throw new MissingConfigError(feature, missing);
}

export function resolveDatabasePath(env: Env): string {
  return path.isAbsolute(env.DATABASE_PATH) || env.DATABASE_PATH === ':memory:'
    ? env.DATABASE_PATH
    : path.join(REPO_ROOT, env.DATABASE_PATH);
}

let cached: Env | undefined;
export function getConfig(): Env {
  if (!cached) {
    loadDotEnv();
    cached = parseEnv();
  }
  return cached;
}
