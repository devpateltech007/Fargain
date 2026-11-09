import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config.js';

/** Routes reachable without the API token: health, provider webhooks (signature-verified), PayPal redirects. */
const PUBLIC_PREFIXES = ['/api/health', '/api/payments/webhook', '/webhooks/', '/paypal/'];

const digest = (s: string) => createHash('sha256').update(s).digest();

export function tokenMatches(presented: string, expected: string): boolean {
  // Hash both sides so lengths match and comparison is constant-time.
  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * Requires `Authorization: Bearer <FARGAIN_API_TOKEN>` on /api/* routes.
 * If no token is configured, auth is disabled outside production (with a warning); in
 * production the app refuses to start (see assertAuthConfigured).
 */
export function registerAuth(app: FastifyInstance, env: Env): void {
  const expected = env.FARGAIN_API_TOKEN;
  if (!expected) {
    app.log.warn(
      'FARGAIN_API_TOKEN not set: /api/* is unauthenticated (allowed only outside production)',
    );
    return;
  }
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/') || PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return;
    const header = req.headers.authorization ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!presented || !tokenMatches(presented, expected)) {
      return reply
        .status(401)
        .send({ error: { code: 'unauthorized', message: 'missing or invalid API token' } });
    }
  });
}

export function assertAuthConfigured(env: Env): void {
  if (env.NODE_ENV === 'production' && !env.FARGAIN_API_TOKEN) {
    throw new Error('FARGAIN_API_TOKEN must be set in production');
  }
}
