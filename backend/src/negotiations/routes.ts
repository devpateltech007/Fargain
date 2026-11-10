import {
  BuyerMessageBody,
  ConfirmPriceBody,
  CreateNegotiationBody,
  DraftRequestBody,
  SellerMessageBody,
} from '@fargain/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { ApiError, notFound } from '../http/errors.js';
import { exceedsMaxPrice } from '../payments/policy.js';
import { NOW_SQL, getItem, getNegotiation, listMessages, type NegotiationRow } from '../store.js';
import { createNegotiationAgent, serializeMessage, serializeNegotiation } from './agent.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const ListQuery = z.object({ listing_url: z.string().url().max(2048).optional() }).strict();

export async function negotiationRoutes(app: FastifyInstance): Promise<void> {
  const { db, userId, env } = app.deps;
  const agent = createNegotiationAgent({
    db,
    userId,
    currency: env.PAYPAL_CURRENCY,
    llm: app.deps.llm,
  });

  const load = (id: number) => {
    const found = getNegotiation(db, userId, id);
    if (!found) throw notFound('negotiation');
    return found;
  };

  /** Full view used by the side panel and dashboard. */
  const view = (id: number) => {
    const { negotiation, item } = load(id);
    return {
      ...serializeNegotiation(negotiation),
      item,
      messages: listMessages(db, id).map(serializeMessage),
    };
  };

  app.post('/api/negotiations', async (req, reply) => {
    const b = CreateNegotiationBody.parse(req.body);
    const item = getItem(db, userId, b.item_id);
    if (!item) throw notFound('wishlist item');
    const id = Number(
      db
        .prepare(
          'INSERT INTO negotiations (item_id, platform, listing_url, seller_label, listing_json) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          item.id,
          b.platform,
          b.listing_url ?? null,
          b.seller_label ?? null,
          JSON.stringify(b.listing ?? {}),
        ).lastInsertRowid,
    );
    db.prepare(
      `UPDATE wishlist_items SET status = 'negotiating', updated_at = ${NOW_SQL} WHERE id = ? AND status = 'watching'`,
    ).run(item.id);
    audit(db, {
      userId,
      actor: 'user',
      action: 'negotiation.created',
      detail: {
        negotiation_id: id,
        item_id: item.id,
        platform: b.platform,
        listing_url: b.listing_url ?? null,
      },
    });
    return reply.status(201).send(view(id));
  });

  app.get('/api/negotiations', async (req) => {
    const { listing_url } = ListQuery.parse(req.query);
    const rows = db
      .prepare(
        `SELECT n.* FROM negotiations n JOIN wishlist_items i ON i.id = n.item_id
         WHERE i.user_id = ? AND (? IS NULL OR n.listing_url = ?)
         ORDER BY n.id DESC`,
      )
      .all(userId, listing_url ?? null, listing_url ?? null) as NegotiationRow[];
    return { negotiations: rows.map(serializeNegotiation) };
  });

  app.get('/api/negotiations/:id', async (req) => view(IdParams.parse(req.params).id));

  app.post('/api/negotiations/:id/draft', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { instructions } = DraftRequestBody.parse(req.body ?? {});
    const { negotiation, item } = load(id);
    const r = await agent.draft(negotiation, item, instructions);
    return {
      message: serializeMessage(r.message),
      draft: r.draft,
      blocked: r.blocked,
      violations: r.violations,
      risk_flags: r.risk_flags,
      assessment: r.assessment,
    };
  });

  app.post('/api/negotiations/:id/seller-message', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { text } = SellerMessageBody.parse(req.body);
    const { negotiation, item } = load(id);
    const r = await agent.recordSellerMessage(negotiation, item, text, app.deps.llmConfigured);
    return reply.status(201).send({
      message: serializeMessage(r.message),
      risk_flags: r.risk_flags,
      agreement: r.agreement,
      ...(r.agreement_error ? { agreement_error: r.agreement_error } : {}),
    });
  });

  app.post('/api/negotiations/:id/buyer-message', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    const { text, draft_message_id } = BuyerMessageBody.parse(req.body);
    const { negotiation, item } = load(id);
    const message = agent.recordBuyerMessage(negotiation, item, text, draft_message_id);
    return reply.status(201).send({ message: serializeMessage(message) });
  });

  app.post('/api/negotiations/:id/confirm-price', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { agreed_price } = ConfirmPriceBody.parse(req.body);
    const { negotiation, item } = load(id);

    if (negotiation.status === 'paid')
      throw new ApiError(409, 'already_paid', 'this negotiation has already been paid');
    if (negotiation.status === 'abandoned')
      throw new ApiError(409, 'negotiation_closed', 'this negotiation was abandoned');
    if (exceedsMaxPrice(agreed_price, item.max_price)) {
      audit(db, {
        userId,
        actor: 'system',
        action: 'negotiation.confirm_rejected',
        detail: {
          negotiation_id: id,
          item_id: item.id,
          agreed_price,
          max_price: item.max_price,
          code: 'exceeds_max_price',
        },
      });
      throw new ApiError(
        422,
        'exceeds_max_price',
        'agreed price is above the max price for this item',
      );
    }

    db.prepare(
      `UPDATE negotiations SET status = 'agreed', agreed_price = ?, updated_at = ${NOW_SQL} WHERE id = ?`,
    ).run(agreed_price, id);
    audit(db, {
      userId,
      actor: 'user',
      action: 'negotiation.price_confirmed',
      detail: { negotiation_id: id, agreed_price },
    });
    return view(id);
  });
}
