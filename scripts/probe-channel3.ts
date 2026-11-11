/**
 * Live probe of the Channel3 API shape for the demo products. Prints structure and a few fields;
 * never prints the API key. Writes the raw first product to data/channel3-sample.json (gitignored).
 *   npm run probe:channel3
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, getConfig, requireFeature } from '../backend/src/config.js';

const env = getConfig();
requireFeature(env, 'channel3');
const BASE = 'https://api.trychannel3.com';
const headers = { 'x-api-key': env.CHANNEL3_API_KEY!, 'Content-Type': 'application/json' };

const queries = ['Sony WH-1000XM5', "Nike Air Force 1 '07", 'Apple AirPods Pro 2'];
const keysOf = (o: unknown) =>
  o && typeof o === 'object' ? Object.keys(o as object).join(',') : typeof o;
let sample: unknown;

for (const query of queries) {
  const res = await fetch(`${BASE}/v1/search`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, limit: 5 }),
  });
  const body = (await res.json()) as { products?: Record<string, unknown>[]; [k: string]: unknown };
  console.log(`\n=== "${query}" -> HTTP ${res.status}; top-level keys: ${keysOf(body)}`);
  if (!res.ok) {
    console.log(JSON.stringify(body).slice(0, 500));
    continue;
  }
  const products = body.products ?? [];
  if (!sample && products[0]) sample = products[0];
  if (products[0]) console.log(`product keys: ${keysOf(products[0])}`);
  for (const p of products) {
    const offers = (p.offers as Record<string, unknown>[] | undefined) ?? [];
    console.log(
      `- id=${p.id} title="${String(p.title).slice(0, 70)}" brand=${JSON.stringify(p.brand ?? p.brands ?? null)?.slice(0, 40)} offers=${offers.length}`,
    );
    for (const o of offers.slice(0, 4)) {
      console.log(
        `    ${JSON.stringify({ domain: o.domain, price: o.price, availability: o.availability }).slice(0, 160)}`,
      );
    }
  }
  const first = products[0];
  if (first?.id) {
    const d = await fetch(`${BASE}/v1/products/${encodeURIComponent(String(first.id))}`, {
      headers,
    });
    const dj = (await d.json()) as Record<string, unknown>;
    console.log(
      `GET /v1/products/${first.id} -> HTTP ${d.status}; keys: ${keysOf(dj)}; offers=${(dj.offers as unknown[] | undefined)?.length ?? 'n/a'}`,
    );
  }
}

if (sample) {
  mkdirSync(path.join(REPO_ROOT, 'data'), { recursive: true });
  writeFileSync(
    path.join(REPO_ROOT, 'data', 'channel3-sample.json'),
    JSON.stringify(sample, null, 2),
  );
  console.log('\nraw sample written to data/channel3-sample.json');
}
