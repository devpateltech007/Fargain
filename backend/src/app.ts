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
import { createChannel3Client, type Channel3Api } from './pricing/channel3.js';
import { pricingRoutes } from './pricing/routes.js';
import type { Messenger } from './reels/messenger.js';
import { reelRoutes } from './reels/routes.js';
import { ensureDefaultUser } from './users.js';
import { wishlistRoutes } from './wishlist/routes.js';

export interface BuildAppOptions {
  env: Env;
  db: Db;
  /** Override the PayPal client (tests). Defaults to the real sandbox client built from env. */
  paypal?: PayPalApi;
  /** Override the LLM provider (tests). Defaults to Anthropic built from env. */
  llm?: LlmProvider;
  /** Override the Channel3 client (tests). Defaults to the real client built from env. */
  channel3?: Channel3Api;
  /** Override the Instagram DM sender (tests). Defaults to the Send API built from env. */
  messenger?: Messenger;
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
  /** Returns the Channel3 client or throws MissingConfigError (-> HTTP 503). */
  channel3: () => Channel3Api;
  /** Test override for Instagram replies; undefined means "build from env if configured". */
  messenger?: Messenger;
}

export async function buildApp({
  env,
  db,
  paypal,
  llm,
  channel3,
  messenger,
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
  let channel3Client = channel3;
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
    channel3: () => {
      if (!channel3Client) {
        requireFeature(env, 'channel3');
        channel3Client = createChannel3Client(env.CHANNEL3_API_KEY!);
      }
      return channel3Client;
    },
    messenger,
  };
  app.decorate('deps', deps);

  registerErrorHandler(app);
  registerAuth(app, env);

  // Treat an empty body with Content-Type: application/json as "no body" (Postman/curl send this
  // for action endpoints like POST /api/pricing/refresh). Invalid JSON is still a 400.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error('request body is not valid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  app.get('/api/health', async () => ({
    ok: true,
    paypal_env: env.PAYPAL_ENV,
    db: db.pragma('user_version', { simple: true }),
    llm_configured: deps.llmConfigured,
  }));

  await app.register(wishlistRoutes);
  await app.register(negotiationRoutes);
  await app.register(paymentRoutes);
  await app.register(pricingRoutes);
  await app.register(reelRoutes);

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
