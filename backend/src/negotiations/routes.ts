import { ConfirmPriceBody, CreateNegotiationBody } from '@fargain/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { ApiError, notFound } from '../http/errors.js';
import { exceedsMaxPrice } from '../payments/policy.js';
import { NOW_SQL, getItem, getNegotiation } from '../store.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

/**
 * Phase 1 subset: create a negotiation and let the USER confirm the agreed price.
 * LLM drafting and seller messages arrive in Phase 2.
 */
export async function negotiationRoutes(app: FastifyInstance): Promise<void> {
  const { db, userId } = app.deps;

  app.post('/api/negotiations', async (req, reply) => {
    const b = CreateNegotiationBody.parse(req.body);
    const item = getItem(db, userId, b.item_id);
    if (!item) throw notFound('wishlist item');
    const id = Number(
      db
        .prepare(
          'INSERT INTO negotiations (item_id, platform, listing_url, seller_label) VALUES (?, ?, ?, ?)',
        )
        .run(item.id, b.platform, b.listing_url ?? null, b.seller_label ?? null).lastInsertRowid,
    );
    db.prepare(
      `UPDATE wishlist_items SET status = 'negotiating', updated_at = ${NOW_SQL} WHERE id = ? AND status = 'watching'`,
    ).run(item.id);
    audit(db, {
      userId,
      actor: 'user',
      action: 'negotiation.created',
      detail: { negotiation_id: id, item_id: item.id, platform: b.platform },
    });
    return reply.status(201).send(getNegotiation(db, userId, id)!.negotiation);
  });

  app.get('/api/negotiations/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    const found = getNegotiation(db, userId, id);
    if (!found) throw notFound('negotiation');
    return found.negotiation;
  });

  app.post('/api/negotiations/:id/confirm-price', async (req) => {
    const { id } = IdParams.parse(req.params);
    const { agreed_price } = ConfirmPriceBody.parse(req.body);
    const found = getNegotiation(db, userId, id);
    if (!found) throw notFound('negotiation');
    const { negotiation, item } = found;

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
    return getNegotiation(db, userId, id)!.negotiation;
  });
}
