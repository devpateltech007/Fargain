/**
 * Live pricing smoke test: real Channel3 (and real LLM for title->query if configured), backend
 * hosted in-process on a throwaway in-memory DB.
 *   npm run smoke:pricing
 */
import { buildApp } from '../backend/src/app.js';
import { getConfig } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/index.js';

const env = { ...getConfig(), LOG_LEVEL: 'warn' as const, DEV_ROUTES_ENABLED: true };
const db = openDatabase(':memory:');
const app = await buildApp({ env, db });
const base = await app.listen({ port: 0, host: '127.0.0.1' });
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (env.FARGAIN_API_TOKEN) headers.Authorization = `Bearer ${env.FARGAIN_API_TOKEN}`;
const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

let failures = 0;
const check = (label: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` - ${extra}` : ''}`);
  if (!ok) failures++;
};

await api('PUT', '/api/profile', {
  student: true,
  discounts: [{ label: 'Student 10% (demo)', percent: 10, requires: 'student' }],
});

for (const query of ['Sony WH-1000XM5', "Nike Air Force 1 '07", 'Apple AirPods Pro 2']) {
  const r = await api('POST', '/api/pricing/lookup', {
    query,
    current_price: 349.99,
    current_retailer: 'amazon.com',
  });
  const b = r.body;
  check(
    `lookup "${query}"`,
    r.status === 200 && b.best_offer !== null,
    r.status === 200 ? '' : JSON.stringify(b),
  );
  if (r.status !== 200) continue;
  console.log(
    `     matched=${b.matched_products.length} offers_used=${b.offer_count_used} best=${b.best_offer?.domain} $${b.best_offer?.price} fair=$${b.fair_price}`,
  );
  console.log(
    `     excluded: ${
      b.offers
        .filter((o: { excluded: string | null }) => o.excluded)
        .map((o: { domain: string; excluded: string }) => `${o.domain}(${o.excluded})`)
        .join(', ') || 'none'
    }`,
  );
  console.log(
    `     alternatives: ${b.alternatives.map((a: { title: string; lowest_price: number }) => `${a.title.slice(0, 40)} $${a.lowest_price}`).join(' | ') || 'none'}`,
  );
  console.log(
    `     after discounts: best $${b.discounts.best_after_discounts?.final_price} vs amazon $${b.current?.final_price}; save $${b.savings_vs_current}`,
  );
}

const longTitle =
  'Sony WH-1000XM5 The Best Wireless Noise Canceling Headphones with Auto Noise Canceling Optimizer, Crystal Clear Hands-Free Calling, and Alexa Voice Control, Black';
const t = await api('POST', '/api/pricing/lookup', {
  product_title: longTitle,
  brand: 'Visit the Sony Store',
  current_price: 328,
  current_retailer: 'amazon.com',
});
check(
  'long Amazon-style title is reduced to a working query',
  t.status === 200 && t.body.matched_products.length > 0,
  `query="${t.body?.query}" via ${t.body?.query_source}`,
);

const item = await api('POST', '/api/wishlist', {
  title: 'Sony WH-1000XM5',
  target_price: 250,
  max_price: 300,
});
const linked = await api('POST', '/api/pricing/lookup', { item_id: item.body.id });
check(
  'lookup with item_id links Channel3 products',
  linked.status === 200 &&
    JSON.parse((await api('GET', '/api/wishlist')).body.items[0].channel3_product_ids).length > 0,
);
const refresh = await api('POST', '/api/pricing/refresh', {});
check(
  'price watch refreshes via GET /v1/products/{id}',
  refresh.status === 200 && refresh.body.checked === 1 && refresh.body.errors === 0,
  JSON.stringify(refresh.body),
);
const drop = await api('POST', `/api/dev/simulate-price-drop/${item.body.id}`, {});
check(
  'simulated price drop raises an alert',
  drop.status === 201 && drop.body.alert.price > 0,
  `$${drop.body?.alert?.price} at ${drop.body?.alert?.retailer}`,
);
const alerts = await api('GET', '/api/alerts?unseen=true');
check('alert is listed', alerts.body.alerts.length >= 1);

await app.close();
db.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall pricing checks passed');
process.exit(failures ? 1 : 0);
