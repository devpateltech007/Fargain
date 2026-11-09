import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { parseEnv, type Env } from './config.js';
import { openDatabase, type Db } from './db/index.js';
import type { PayPalApi } from './payments/paypal-client.js';

export const TEST_TOKEN = 'test-token-0123456789';

/**
 * Starts a real app on an ephemeral loopback port and returns a fetch helper that sends the
 * API token. We use a real socket instead of `app.inject()` because inject's dependency
 * (light-my-request) needs require(esm), which Node < 20.19 does not support.
 */
export async function startTestApp(
  opts: { env?: Record<string, string>; paypal?: PayPalApi } = {},
): Promise<{
  app: FastifyInstance;
  db: Db;
  env: Env;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  json: (
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ) => Promise<{ status: number; body: any }>; // eslint-disable-line @typescript-eslint/no-explicit-any
  close: () => Promise<void>;
}> {
  const env = parseEnv({ LOG_LEVEL: 'silent', FARGAIN_API_TOKEN: TEST_TOKEN, ...opts.env });
  const db = openDatabase(':memory:');
  const app = await buildApp({ env, db, paypal: opts.paypal });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  const request = (path: string, init?: RequestInit) => fetch(`${address}${path}`, init);
  return {
    app,
    db,
    env,
    request,
    json: async (method, path, body, headers = {}) => {
      const res = await request(path, {
        method,
        headers: {
          Authorization: `Bearer ${TEST_TOKEN}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
