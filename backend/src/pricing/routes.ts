import { PricingLookupBody, SimulatePriceDropBody, UserProfile } from '@fargain/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { NOW_SQL } from '../store.js';
import { createPricingService, loadProfile } from './service.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const ItemParams = z.object({ itemId: z.coerce.number().int().positive() });
const AlertsQuery = z.object({ unseen: z.enum(['true', 'false']).optional() }).strict();

export async function pricingRoutes(app: FastifyInstance): Promise<void> {
  const { db, userId, env } = app.deps;
  const pricing = createPricingService({
    db,
    userId,
    currency: env.PAYPAL_CURRENCY,
    channel3: app.deps.channel3,
    llm: () => (app.deps.llmConfigured ? app.deps.llm() : null),
  });

  app.post('/api/pricing/lookup', async (req) => {
    const b = PricingLookupBody.parse(req.body);
    return pricing.lookup({
      query: b.query,
      productTitle: b.product_title,
      brand: b.brand,
      itemId: b.item_id,
      currentPrice: b.current_price,
      currentRetailer: b.current_retailer,
    });
  });

  /** Run the price watch now (same as the scheduled job). */
  app.post('/api/pricing/refresh', async () => pricing.runPriceWatch());

  app.get('/api/alerts', async (req) => {
    const { unseen } = AlertsQuery.parse(req.query);
    return {
      alerts: pricing
        .listAlerts(unseen === 'true')
        .map(({ detail_json, ...a }) => ({ ...a, detail: JSON.parse(detail_json) as unknown })),
    };
  });

  app.post('/api/alerts/:id/seen', async (req, reply) => {
    const { id } = IdParams.parse(req.params);
    db.prepare(`UPDATE alerts SET seen_at = ${NOW_SQL} WHERE id = ? AND user_id = ?`).run(
      id,
      userId,
    );
    return reply.status(204).send();
  });

  app.get('/api/profile', async () => {
    const u = db
      .prepare('SELECT id, display_name, linked_ig_id FROM users WHERE id = ?')
      .get(userId) as Record<string, unknown>;
    return { ...u, profile: loadProfile(db, userId) };
  });

  /** Profile fields are entered manually by the user (no retailer logins, no email scanning). */
  app.put('/api/profile', async (req) => {
    const profile = UserProfile.parse(req.body);
    db.prepare('UPDATE users SET profile_json = ? WHERE id = ?').run(
      JSON.stringify(profile),
      userId,
    );
    audit(db, {
      userId,
      actor: 'user',
      action: 'profile.updated',
      detail: {
        student: profile.student,
        has_birthday: Boolean(profile.birthday),
        memberships: profile.memberships.length,
        discounts: profile.discounts.length,
      },
    });
    return { profile };
  });

  if (env.DEV_ROUTES_ENABLED) {
    app.post('/api/dev/simulate-price-drop/:itemId', async (req, reply) => {
      const { itemId } = ItemParams.parse(req.params);
      const { price } = SimulatePriceDropBody.parse(req.body ?? {});
      const alert = pricing.simulateDrop(itemId, price);
      return reply.status(201).send({
        simulated: true,
        alert: { ...alert, detail: JSON.parse(alert.detail_json) as unknown },
      });
    });
  }
}
