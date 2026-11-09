import { CreateWishlistItemBody, UpdateWishlistItemBody } from '@fargain/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { ApiError, notFound } from '../http/errors.js';
import { NOW_SQL, getItem, type WishlistItemRow } from '../store.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });

export async function wishlistRoutes(app: FastifyInstance): Promise<void> {
  const { db, userId } = app.deps;

  app.post('/api/wishlist', async (req, reply) => {
    const b = CreateWishlistItemBody.parse(req.body);
    const id = Number(
      db
        .prepare(
          `INSERT INTO wishlist_items (user_id, title, description, image_url, source, source_url, target_price, max_price)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          b.title,
          b.description ?? null,
          b.image_url ?? null,
          b.source,
          b.source_url ?? null,
          b.target_price ?? null,
          b.max_price ?? null,
        ).lastInsertRowid,
    );
    audit(db, {
      userId,
      actor: 'user',
      action: 'wishlist.created',
      detail: { item_id: id, source: b.source },
    });
    return reply.status(201).send(getItem(db, userId, id));
  });

  app.get('/api/wishlist', async () => {
    const items = db
      .prepare('SELECT * FROM wishlist_items WHERE user_id = ? ORDER BY created_at DESC, id DESC')
      .all(userId) as WishlistItemRow[];
    return { items };
  });

  app.patch('/api/wishlist/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    const patch = UpdateWishlistItemBody.parse(req.body);
    const current = getItem(db, userId, id);
    if (!current) throw notFound('wishlist item');

    const next = { ...current, ...patch };
    if (
      next.target_price !== null &&
      next.max_price !== null &&
      next.target_price > next.max_price
    ) {
      throw new ApiError(400, 'invalid_request', 'target_price must be <= max_price');
    }

    const cols = Object.keys(patch) as (keyof typeof patch)[];
    db.prepare(
      `UPDATE wishlist_items SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = ${NOW_SQL}
       WHERE id = @id AND user_id = @userId`,
    ).run({ ...patch, id, userId });

    // max_price changes are security-relevant (they move the payment cap), so record old/new.
    const detail: Record<string, unknown> = { item_id: id, fields: cols };
    if ('max_price' in patch) detail.max_price = { from: current.max_price, to: patch.max_price };
    audit(db, { userId, actor: 'user', action: 'wishlist.updated', detail });
    return getItem(db, userId, id);
  });
}
