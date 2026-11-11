import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { missingFor, requireFeature } from '../config.js';
import { ApiError } from '../http/errors.js';
import { tokenMatches } from '../http/auth.js';
import { createPricingService } from '../pricing/service.js';
import { createMessenger } from './messenger.js';
import {
  canonicalInstagramUrl,
  findInstagramUrl,
  parseInstagramWebhook,
  verifyMetaSignature,
} from './parse.js';
import { createReelService } from './service.js';

const IdentifyBody = z
  .object({
    /** Instagram reel/post link. Used as a reference only; the page is never fetched or scraped. */
    url: z.string().trim().max(500).optional(),
    caption: z.string().trim().max(2200).optional(),
    note: z.string().trim().max(500).optional(),
    /** Optional user screenshot as base64 (no data: prefix), max ~3.75 MB decoded. */
    screenshot_base64: z.string().max(5_000_000).optional(),
    screenshot_media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  })
  .strict()
  .refine((b) => b.url || b.caption || b.screenshot_base64, {
    message: 'url, caption or screenshot_base64 is required',
  })
  .refine((b) => !b.url || findInstagramUrl(b.url), {
    message: 'url must be an instagram.com reel/post link',
    path: ['url'],
  });

const ConfirmBody = z.object({ choice: z.number().int().min(1).max(3) }).strict();
const IdParams = z.object({ id: z.coerce.number().int().positive() });
const HubQuery = z
  .object({ 'hub.mode': z.string(), 'hub.verify_token': z.string(), 'hub.challenge': z.string() })
  .passthrough();

export async function reelRoutes(app: FastifyInstance): Promise<void> {
  const { db, userId, env } = app.deps;
  const pricing = createPricingService({
    db,
    userId,
    currency: env.PAYPAL_CURRENCY,
    channel3: app.deps.channel3,
    llm: () => (app.deps.llmConfigured ? app.deps.llm() : null),
  });
  const reels = createReelService({
    db,
    userId,
    llm: app.deps.llm,
    pricing,
    messenger: () =>
      app.deps.messenger ??
      (missingFor(env, 'instagramSend').length === 0
        ? createMessenger({
            accessToken: env.IG_ACCESS_TOKEN!,
            graphVersion: env.META_GRAPH_VERSION,
          })
        : null),
  });

  // Meta signs the raw bytes; keep them for this plugin's JSON parser (scoped to this plugin).
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
    if ((body as Buffer).length === 0) return done(null, undefined);
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch {
      const err = new Error('request body is not valid JSON') as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  /** Paste-a-link fallback (dashboard). Same pipeline as the DM flow. */
  app.post('/api/reels/identify', async (req) => {
    const b = IdentifyBody.parse(req.body);
    const r = await reels.process(
      {
        sourceUrl: b.url ? canonicalInstagramUrl(findInstagramUrl(b.url)!) : null,
        caption: b.caption ?? null,
        note: b.note ?? null,
        image: b.screenshot_base64
          ? { base64: b.screenshot_base64, mediaType: b.screenshot_media_type ?? 'image/jpeg' }
          : null,
      },
      { channel: 'dashboard', userId },
    );
    return r;
  });

  app.post('/api/reels/:id/confirm', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { choice } = ConfirmBody.parse(req.body);
    return { status: 'added', added: await reels.confirm(id, choice, userId) };
  });

  app.post('/api/link/start', async () => reels.startLink(userId));

  /**
   * Manual confirm (for testing without Instagram): { code, ig_sender_id }. In production the code
   * arrives by DM and is consumed by the webhook; this endpoint is behind the API token.
   */
  app.post('/api/link/confirm', async (req) => {
    const b = z
      .object({ code: z.string().trim(), ig_sender_id: z.string().trim().min(1).max(64) })
      .strict()
      .parse(req.body);
    const uid = reels.confirmLink(b.code, b.ig_sender_id);
    if (!uid) throw new ApiError(400, 'invalid_code', 'code is invalid or expired');
    return { linked: true };
  });

  app.get('/api/link/status', async () => {
    const u = db
      .prepare('SELECT linked_ig_id, link_code, link_code_expires_at FROM users WHERE id = ?')
      .get(userId) as {
      linked_ig_id: string | null;
      link_code: string | null;
      link_code_expires_at: string | null;
    };
    return {
      linked: Boolean(u.linked_ig_id),
      pending_code: u.link_code,
      expires_at: u.link_code_expires_at,
    };
  });

  /** Meta verification handshake. */
  app.get('/webhooks/instagram', async (req, reply) => {
    requireFeature(env, 'instagramWebhook');
    const q = HubQuery.safeParse(req.query);
    if (
      !q.success ||
      q.data['hub.mode'] !== 'subscribe' ||
      !tokenMatches(q.data['hub.verify_token'], env.IG_VERIFY_TOKEN!)
    ) {
      return reply
        .status(403)
        .send({ error: { code: 'forbidden', message: 'verify token mismatch' } });
    }
    return reply.type('text/plain').send(q.data['hub.challenge']);
  });

  /** Incoming DMs. Signature-checked, acknowledged fast, processed after the response. */
  app.post('/webhooks/instagram', async (req, reply) => {
    requireFeature(env, 'instagramWebhook');
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    const sig = req.headers['x-hub-signature-256'];
    if (!verifyMetaSignature(raw, typeof sig === 'string' ? sig : undefined, env.IG_APP_SECRET!)) {
      audit(db, {
        userId: null,
        actor: 'system',
        action: 'instagram.webhook_rejected',
        detail: { reason: 'bad signature' },
      });
      return reply
        .status(401)
        .send({ error: { code: 'invalid_signature', message: 'signature check failed' } });
    }
    const events = parseInstagramWebhook(req.body);
    reply.status(200).send({ received: events.length });
    // Process after acking so Meta doesn't time out and retry (duplicates are ignored by mid anyway).
    for (const dm of events) {
      try {
        const outcome = await reels.handleDm(dm);
        app.log.info({ outcome, has_share: Boolean(dm.share) }, 'instagram dm handled');
      } catch (err) {
        app.log.error({ err }, 'instagram dm failed');
      }
    }
    return reply;
  });
}
