import Fastify, { type FastifyInstance } from 'fastify';
import { requireFeature, type Env } from './config.js';
import type { Db } from './db/index.js';
import { assertAuthConfigured, registerAuth } from './http/auth.js';
import { registerErrorHandler } from './http/errors.js';
import { negotiationRoutes } from './negotiations/routes.js';
import { createPayPalClient, type PayPalApi } from './payments/paypal-client.js';
import { paymentRoutes } from './payments/routes.js';
import { ensureDefaultUser } from './users.js';
import { wishlistRoutes } from './wishlist/routes.js';

export interface BuildAppOptions {
  env: Env;
  db: Db;
  /** Override the PayPal client (tests). Defaults to the real sandbox client built from env. */
  paypal?: PayPalApi;
}

export interface AppDeps {
  env: Env;
  db: Db;
  /** Single-user demo: the user every API request acts as. */
  userId: number;
  /** Returns the PayPal client or throws MissingConfigError (-> HTTP 503). */
  paypal: () => PayPalApi;
}

export async function buildApp({ env, db, paypal }: BuildAppOptions): Promise<FastifyInstance> {
  assertAuthConfigured(env);

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

  let paypalClient = paypal;
  const deps: AppDeps = {
    env,
    db,
    userId: ensureDefaultUser(db),
    paypal: () => {
      if (!paypalClient) {
        requireFeature(env, 'paypal');
        paypalClient = createPayPalClient(env.PAYPAL_CLIENT_ID!, env.PAYPAL_CLIENT_SECRET!);
      }
      return paypalClient;
    },
  };
  app.decorate('deps', deps);

  registerErrorHandler(app);
  registerAuth(app, env);

  app.get('/api/health', async () => ({
    ok: true,
    paypal_env: env.PAYPAL_ENV,
    db: db.pragma('user_version', { simple: true }),
  }));

  await app.register(wishlistRoutes);
  await app.register(negotiationRoutes);
  await app.register(paymentRoutes);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
