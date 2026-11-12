import path from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
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
import { demoRoutes } from './demo/routes.js';
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

  app.get('/api/dashboard/summary', async () => {
    const wishlist = db
      .prepare(
        `SELECT COUNT(*) AS total,
          SUM(CASE WHEN status = 'watching' THEN 1 ELSE 0 END) AS watching,
          SUM(CASE WHEN status = 'negotiating' THEN 1 ELSE 0 END) AS negotiating,
          SUM(CASE WHEN status = 'purchased' THEN 1 ELSE 0 END) AS purchased
         FROM wishlist_items WHERE user_id = ?`,
      )
      .get(deps.userId) as {
      total: number;
      watching: number;
      negotiating: number;
      purchased: number;
    };
    const counts = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM negotiations n JOIN wishlist_items i ON i.id=n.item_id WHERE i.user_id=?) AS negotiations,
          (SELECT COUNT(*) FROM payments p JOIN negotiations n ON n.id=p.negotiation_id JOIN wishlist_items i ON i.id=n.item_id WHERE i.user_id=?) AS payments,
          (SELECT COALESCE(SUM(p.amount),0) FROM payments p JOIN negotiations n ON n.id=p.negotiation_id JOIN wishlist_items i ON i.id=n.item_id WHERE i.user_id=? AND p.status='COMPLETED') AS paid_total,
          (SELECT COALESCE(SUM(CASE WHEN n.agreed_price IS NOT NULL AND CAST(json_extract(n.listing_json, '$.price') AS REAL) > n.agreed_price
             THEN CAST(json_extract(n.listing_json, '$.price') AS REAL)-n.agreed_price ELSE 0 END),0)
             FROM negotiations n JOIN wishlist_items i ON i.id=n.item_id WHERE i.user_id=? AND n.status IN ('agreed','paid')) AS saved_total`,
      )
      .get(deps.userId, deps.userId, deps.userId, deps.userId) as {
      negotiations: number;
      payments: number;
      paid_total: number;
      saved_total: number;
    };
    return { ...wishlist, ...counts };
  });

  app.get('/api/dashboard/audit', async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().max(100).optional(),
      })
      .strict()
      .parse(req.query);
    const entries = db
      .prepare(
        `SELECT id, actor, action, detail_json, created_at FROM audit_log
           WHERE user_id = ? AND (? IS NULL OR action = ?)
           ORDER BY id DESC LIMIT ?`,
      )
      .all(deps.userId, query.action ?? null, query.action ?? null, query.limit)
      .map((row) => {
        const entry = row as {
          id: number;
          actor: string;
          action: string;
          detail_json: string;
          created_at: string;
        };
        return {
          id: `audit-${entry.id}`,
          actor: entry.actor,
          action: entry.action,
          detail: JSON.parse(entry.detail_json) as unknown,
          created_at: entry.created_at,
        };
      });
    const reasoning = db
      .prepare(
        `SELECT m.id, m.text, m.ai_reasoning_json, m.created_at, i.title
         FROM messages m JOIN negotiations n ON n.id=m.negotiation_id
         JOIN wishlist_items i ON i.id=n.item_id
         WHERE i.user_id=? AND m.ai_reasoning_json IS NOT NULL ORDER BY m.id DESC LIMIT ?`,
      )
      .all(deps.userId, query.limit)
      .map((row) => {
        const message = row as {
          id: number;
          text: string;
          ai_reasoning_json: string;
          created_at: string;
          title: string;
        };
        return {
          id: `reason-${message.id}`,
          actor: 'agent',
          action: 'agent.suggestion',
          detail: {
            item: message.title,
            text: message.text,
            reasoning: JSON.parse(message.ai_reasoning_json) as unknown,
          },
          created_at: message.created_at,
        };
      });
    return {
      entries: [...entries, ...reasoning]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, query.limit),
    };
  });

  app.get('/api/dashboard/wishlist', async () => {
    return {
      items: db
        .prepare(
          `SELECT i.*, (SELECT MIN(latest.price) FROM price_snapshots latest WHERE latest.item_id=i.id
             AND latest.id=(SELECT MAX(prior.id) FROM price_snapshots prior WHERE prior.item_id=i.id AND prior.retailer=latest.retailer)) AS best_price,
            (SELECT COUNT(*) FROM alerts a WHERE a.item_id=i.id AND a.user_id=i.user_id AND a.seen_at IS NULL) AS unseen_alerts
           FROM wishlist_items i WHERE i.user_id=? ORDER BY i.created_at DESC, i.id DESC`,
        )
        .all(deps.userId),
    };
  });

  app.get('/api/dashboard/payments', async () => ({
    payments: db
      .prepare(
        `SELECT p.id, p.negotiation_id, p.paypal_order_id, p.amount, p.currency, p.status, p.approve_url, p.created_at, i.title
         FROM payments p JOIN negotiations n ON n.id=p.negotiation_id
         JOIN wishlist_items i ON i.id=n.item_id WHERE i.user_id=? ORDER BY p.id DESC`,
      )
      .all(deps.userId),
  }));

  await app.register(wishlistRoutes);
  await app.register(negotiationRoutes);
  await app.register(paymentRoutes);
  await app.register(pricingRoutes);
  await app.register(reelRoutes);
  await app.register(demoRoutes);

  // Static mock seller page (a stand-in "third-party" marketplace chat for repeatable demos).
  await app.register(fastifyStatic, {
    root: path.join(REPO_ROOT, 'mock-seller'),
    prefix: '/mock-seller/',
  });

  // The production build serves the dashboard from the backend origin. Vite serves it separately
  // during development, so this only succeeds after the dashboard workspace has been built.
  const dashboardDist = path.join(REPO_ROOT, 'dashboard', 'dist');
  if (existsSync(dashboardDist)) {
    await app.register(fastifyStatic, {
      root: dashboardDist,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });
  }

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
