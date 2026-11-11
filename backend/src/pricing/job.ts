import type { FastifyInstance } from 'fastify';
import { createPricingService } from './service.js';

/**
 * In-process price watch. Uses Channel3's free GET /v1/products/{id} for items that have been
 * matched (via POST /api/pricing/lookup with item_id). Runs once shortly after boot, then on the
 * interval. Overlapping runs are skipped.
 */
export function startPriceWatch(app: FastifyInstance, intervalMinutes: number): () => void {
  const { db, userId, env, channel3 } = app.deps;
  // The price watch only refreshes already-matched products, so it never needs the LLM.
  const pricing = createPricingService({ db, userId, currency: env.PAYPAL_CURRENCY, channel3 });
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await pricing.runPriceWatch();
      app.log.info(r, 'price watch run');
    } catch (err) {
      app.log.error({ err }, 'price watch failed');
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void tick(), 30_000);
  const timer = setInterval(() => void tick(), intervalMinutes * 60_000);
  first.unref();
  timer.unref();
  app.log.info({ intervalMinutes }, 'price watch scheduled');
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
