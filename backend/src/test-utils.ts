import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { parseEnv, type Env } from './config.js';
import { openDatabase, type Db } from './db/index.js';

/**
 * Starts a real app on an ephemeral loopback port and returns a fetch helper.
 * We use a real socket instead of `app.inject()` because inject's dependency (light-my-request)
 * needs require(esm), which Node < 20.19 does not support.
 */
export async function startTestApp(envOverrides: Record<string, string> = {}): Promise<{
  app: FastifyInstance;
  db: Db;
  env: Env;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}> {
  const env = parseEnv({ LOG_LEVEL: 'silent', ...envOverrides });
  const db = openDatabase(':memory:');
  const app = await buildApp({ env, db });
  const address = await app.listen({ port: 0, host: '127.0.0.1' });
  return {
    app,
    db,
    env,
    request: (path, init) => fetch(`${address}${path}`, init),
    close: async () => {
      await app.close();
      db.close();
    },
  };
}
