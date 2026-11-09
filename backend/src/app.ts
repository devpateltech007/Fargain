import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from './config.js';
import type { Db } from './db/index.js';

export interface AppDeps {
  env: Env;
  db: Db;
}

export async function buildApp({ env, db }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Never log credentials or webhook signatures.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers["x-hub-signature-256"]',
          'req.headers["paypal-transmission-sig"]',
          'req.headers.cookie',
        ],
        censor: '[redacted]',
      },
    },
  });

  app.decorate('deps', { env, db });

  app.get('/api/health', async () => ({
    ok: true,
    paypal_env: env.PAYPAL_ENV,
    db: db.pragma('user_version', { simple: true }),
  }));

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
