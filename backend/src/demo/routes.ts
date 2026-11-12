import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { compareOffers } from '../pricing/compare.js';
import { getItem } from '../store.js';

const StartDemoBody = z.object({ run_id: z.string().uuid() }).strict();
const MAX_PRICE = 130;
const TARGET_PRICE = 120;
const MARKETPLACE_URL = 'https://www.facebook.com/marketplace/item/1469470546248672/';
const FIXTURE_OFFERS = [
  { retailer: 'Amazon', price: 299.99 },
  { retailer: 'Best Buy', price: 299.99 },
  { retailer: 'Sony', price: 329.99 },
];

/** Explicit, repeatable demo fixtures for the scripted Reel-to-Marketplace walkthrough. */
export async function demoRoutes(app: FastifyInstance): Promise<void> {
  const { db, userId, env } = app.deps;

  app.post('/api/demo/sony/start', async (req, reply) => {
    const { run_id } = StartDemoBody.parse(req.body);
    const runMarker = `Simulated Instagram DM · ${run_id}`;
    const existing = db
      .prepare('SELECT id FROM wishlist_items WHERE user_id = ? AND description = ?')
      .get(userId, runMarker) as { id: number } | undefined;

    let itemId = existing?.id;
    if (itemId === undefined) {
      itemId = Number(
        db
          .prepare(
            `INSERT INTO wishlist_items
              (user_id, title, description, source, target_price, max_price)
             VALUES (?, ?, ?, 'instagram', ?, ?)`,
          )
          .run(
            userId,
            'Sony WH-1000XM5 Wireless Noise-Canceling Headphones',
            `${runMarker}. Sony WH-1000XM5 Reel with a $130 buyer maximum.`,
            TARGET_PRICE,
            MAX_PRICE,
          ).lastInsertRowid,
      );
    }

    const item = getItem(db, userId, itemId);
    if (!item) throw new Error('demo item could not be loaded');

    // Prefer real Channel3 results when they support the scripted above-budget story.
    // Otherwise use clearly labeled fixture prices so the demo remains repeatable.
    let offers: { retailer: string; price: number; url: string | null }[] = [];
    let offerSource: 'channel3_live' | 'demo_fixture' = 'demo_fixture';
    try {
      const query = 'Sony WH-1000XM5';
      const products = await app.deps.channel3().search(query, 30);
      const liveOffers = compareOffers(query, products, env.PAYPAL_CURRENCY).offers
        .filter((offer) => !offer.excluded)
        .map((offer) => ({ retailer: offer.domain, price: offer.price, url: offer.url }));
      const lowest = liveOffers.reduce<number | null>(
        (value, offer) => (value === null || offer.price < value ? offer.price : value),
        null,
      );
      if (liveOffers.length && lowest !== null && lowest > MAX_PRICE) {
        offers = liveOffers.slice(0, 8);
        offerSource = 'channel3_live';
      }
    } catch {
      // Demo fixtures are an intentional fallback when Channel3 is unavailable.
    }
    if (offers.length === 0) {
      offers = FIXTURE_OFFERS.map((offer) => ({ ...offer, url: null }));
    }

    if (!existing) {
      const insertSnapshot = db.prepare(
        'INSERT INTO price_snapshots (item_id, retailer, price, url) VALUES (?, ?, ?, ?)',
      );
      for (const offer of offers) {
        insertSnapshot.run(itemId, offer.retailer, offer.price, offer.url);
      }
    }

    audit(db, {
      userId,
      actor: 'user',
      action: 'demo.sony_flow_started',
      detail: {
        item_id: itemId,
        simulated_instagram_dm: true,
        buyer_max_price: MAX_PRICE,
        target_price: TARGET_PRICE,
        offer_source: offerSource,
        marketplace_url: MARKETPLACE_URL,
      },
    });

    return reply.status(existing ? 200 : 201).send({
      simulated: true,
      item_id: itemId,
      title: item.title,
      buyer_max_price: MAX_PRICE,
      target_price: TARGET_PRICE,
      offer_source: offerSource,
      offers,
      best_price: Math.min(...offers.map((offer) => offer.price)),
      marketplace: {
        url: MARKETPLACE_URL,
        title: 'Sony WH-1000XM5 headphones',
        asking_price: 145,
      },
    });
  });
}
