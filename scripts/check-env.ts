/**
 * Reports which env vars are configured, without ever printing secret values.
 *   npm run check-env        -> presence check only
 *   npm run check-env:live   -> also makes one harmless call per configured provider
 *                               (PayPal sandbox OAuth token, Anthropic model list, one Channel3 search)
 */
import {
  EnvSchema,
  FEATURE_REQUIREMENTS,
  PAYPAL_API_BASE,
  SECRET_KEYS,
  loadDotEnv,
  missingFor,
  parseEnv,
  type Env,
  type Feature,
} from '../backend/src/config.js';
import { ANTHROPIC_VERSION } from '../backend/src/llm/anthropic.js';

const live = process.argv.includes('--live');
const loaded = loadDotEnv();
console.log(
  loaded ? 'Loaded .env from repo root.' : 'No .env found at repo root (using process env only).',
);

let env: Env;
try {
  env = parseEnv();
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
}

const secret = new Set<string>(SECRET_KEYS);
console.log('\nVariables:');
for (const key of Object.keys(EnvSchema.shape) as (keyof Env)[]) {
  const v = env[key];
  const shown = v === undefined ? 'MISSING' : secret.has(key) ? 'set' : String(v);
  console.log(`  ${key.padEnd(24)} ${shown}`);
}

console.log('\nFeatures:');
for (const f of Object.keys(FEATURE_REQUIREMENTS) as Feature[]) {
  const missing = missingFor(env, f);
  console.log(`  ${f.padEnd(14)} ${missing.length ? `missing ${missing.join(', ')}` : 'ready'}`);
}

if (!live) process.exit(0);

console.log('\nLive checks:');

async function check(name: string, ready: boolean, fn: () => Promise<string>) {
  if (!ready) return console.log(`  ${name.padEnd(10)} skipped (not configured)`);
  try {
    console.log(`  ${name.padEnd(10)} OK  ${await fn()}`);
  } catch (e) {
    console.log(`  ${name.padEnd(10)} FAIL ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
}

await check('paypal', missingFor(env, 'paypal').length === 0, async () => {
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString(
    'base64',
  );
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from sandbox OAuth`);
  const body = (await res.json()) as { expires_in?: number };
  return `sandbox access token issued (expires_in=${body.expires_in}s)`;
});

await check('anthropic', env.ANTHROPIC_API_KEY !== undefined, async () => {
  const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY!, 'anthropic-version': ANTHROPIC_VERSION },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from /v1/models`);
  const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id);
  const notes = [`available: ${ids.join(', ')}`];
  for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_VISION_MODEL'] as const) {
    if (env[k] && !ids.includes(env[k]!)) notes.push(`WARNING ${k} is not in the list`);
  }
  return notes.join(' | ');
});

await check('channel3', env.CHANNEL3_API_KEY !== undefined, async () => {
  const res = await fetch('https://api.trychannel3.com/v1/search', {
    method: 'POST',
    headers: { 'x-api-key': env.CHANNEL3_API_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Nike Air Force 1', limit: 1 }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from /v1/search`);
  const body = (await res.json()) as { products?: unknown[] };
  return `search returned ${body.products?.length ?? 0} product(s)`;
});

console.log('  instagram  skipped (verified in Phase 5)');
