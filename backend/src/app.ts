import path from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { REPO_ROOT, missingFor, requireFeature, type Env } from './config.js';
import type { Db } from './db/index.js';
import { assertAuthConfigured, registerAuth } from './http/auth.js';
import { registerErrorHandler } from './http/errors.js';
import { createAnthropicProvider } from './llm/anthropic.js';
import type { LlmProvider } from './llm/provider.js';
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
  /** Override the LLM provider (tests). Defaults to Anthropic built from env. */
  llm?: LlmProvider;
}

export interface AppDeps {
  env: Env;
  db: Db;
  /** Single-user demo: the user every API request acts as. */
  userId: number;
  /** Returns the PayPal client or throws MissingConfigError (-> HTTP 503). */
  paypal: () => PayPalApi;
  /** Returns the LLM provider or throws MissingConfigError (-> HTTP 503). */
  llm: () => LlmProvider;
  llmConfigured: boolean;
}

export async function buildApp({
  env,
  db,
  paypal,
  llm,
}: BuildAppOptions): Promise<FastifyInstance> {
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
  let llmProvider = llm;
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
    llm: () => {
      if (!llmProvider) {
        requireFeature(env, 'llm');
        llmProvider = createAnthropicProvider({
          apiKey: env.ANTHROPIC_API_KEY!,
          textModel: env.ANTHROPIC_MODEL!,
          visionModel: env.ANTHROPIC_VISION_MODEL ?? env.ANTHROPIC_MODEL!,
        });
      }
      return llmProvider;
    },
    llmConfigured: llm !== undefined || missingFor(env, 'llm').length === 0,
  };
  app.decorate('deps', deps);

  registerErrorHandler(app);
  registerAuth(app, env);

  app.get('/api/health', async () => ({
    ok: true,
    paypal_env: env.PAYPAL_ENV,
    db: db.pragma('user_version', { simple: true }),
    llm_configured: deps.llmConfigured,
  }));

  await app.register(wishlistRoutes);
  await app.register(negotiationRoutes);
  await app.register(paymentRoutes);

  // Static mock seller page (a stand-in "third-party" marketplace chat for repeatable demos).
  await app.register(fastifyStatic, {
    root: path.join(REPO_ROOT, 'mock-seller'),
    prefix: '/mock-seller/',
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
