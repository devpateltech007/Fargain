import { UserProfile } from '@fargain/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../test-utils.js';
import type { Channel3Api, Channel3Product } from './channel3.js';
import {
  cheaperAlternatives,
  compareOffers,
  isExactMatch,
  isUsStore,
  normalize,
  tokens,
} from './compare.js';
import { applyProfileDiscounts } from './discounts.js';
import { AF1_RESULTS, AIRPODS_RESULTS, XM5_RESULTS } from './fixtures.js';
import { cleanBrand, heuristicQuery } from './query.js';

describe('compareOffers on recorded Channel3 results', () => {
  it('pools duplicate Channel3 products and finds the best US offer for the XM5', () => {
    const c = compareOffers('Sony WH-1000XM5', XM5_RESULTS);
    expect(c.matched_products).toHaveLength(5);
    expect(c.best_offer).toMatchObject({ domain: 'bhphotovideo.com', price: 298 });
    // crutchfield.ca is shown but not used: Canadian store pricing in USD.
    expect(c.offers.find((o) => o.domain === 'crutchfield.ca')?.excluded).toBe('non_us_store');
    expect(c.offer_count_used).toBe(5);
    expect(c.fair_price).toBe(340);
  });

  it('excludes the implausible $10 Air Force 1 offer from best and fair price', () => {
    const c = compareOffers("Nike Air Force 1 '07", AF1_RESULTS);
    expect(c.offers.find((o) => o.domain === 'dtlr.com')?.excluded).toBe('suspiciously_low');
    expect(c.best_offer).toMatchObject({ domain: 'kickscrew.com', price: 58.5 });
    expect(c.offers.find((o) => o.domain === 'footlocker.ca')?.excluded).toBe('non_us_store');
  });

  it('does not treat AirPods Max or AirPods Pro (gen 1) as AirPods Pro 2', () => {
    const c = compareOffers('Apple AirPods Pro 2', AIRPODS_RESULTS);
    expect(c.matched_products.map((p) => p.id).sort()).toEqual(['OMBs5vc', 'RWvTn6A']);
    expect(c.best_offer).toMatchObject({ domain: 'bestbuy.com', price: 249.95 });
  });

  it('suggests cheaper alternatives in the same category, never the item itself', () => {
    const alts = cheaperAlternatives('Apple AirPods Pro 2', AIRPODS_RESULTS, {
      categorySlug: 'headphones',
      belowPrice: 300,
    });
    expect(alts.map((a) => a.product_id)).toEqual(['qvAURc6']);
    expect(
      cheaperAlternatives('x', AIRPODS_RESULTS, { categorySlug: 'headphones', belowPrice: null }),
    ).toEqual([]);
  });

  it('normalizes model numbers and apostrophes', () => {
    expect(normalize("WH-1000XM5 Air Force 1 '07")).toBe('wh1000xm5 air force 1 07');
    expect(tokens('Airpods Pro 2nd Generation w/ Magsafe')).toEqual([
      'airpods',
      'pro',
      '2',
      'w',
      'magsafe',
    ]);
    expect(isExactMatch('Sony WH-1000XM5', XM5_RESULTS[0]!)).toBe(true); // brand from `brands`
    expect(isUsStore('bestbuy.com')).toBe(true);
    expect(isUsStore('footlocker.ca')).toBe(false);
    expect(isUsStore('argos.co.uk')).toBe(false);
    // Live regression: a refurbished marketplace offer must not count as the best new price.
    const refurb = structuredClone(XM5_RESULTS);
    refurb[0]!.offers.push({
      ...refurb[0]!.offers[0]!,
      domain: 'backmarket.com',
      price: { price: 178.5, compare_at_price: null, currency: 'USD' },
    });
    const c = compareOffers('Sony WH-1000XM5', refurb);
    expect(c.offers.find((o) => o.domain === 'backmarket.com')?.excluded).toBe('used');
    expect(c.best_offer?.domain).toBe('bhphotovideo.com');
  });
});

describe('query from a long retail title (no LLM)', () => {
  it('keeps brand + model tokens and drops marketing words', () => {
    expect(
      heuristicQuery(
        'Sony WH-1000XM5 The Best Wireless Noise Canceling Headphones with Auto Noise Canceling Optimizer, Crystal Clear Hands-Free Calling, Black',
        'Visit the Sony Store',
      ),
    ).toBe('Sony WH-1000XM5');
    // No letter+digit model token, so it falls back to the first 4 words.
    expect(
      heuristicQuery('Apple AirPods Pro 2 Wireless Earbuds, Active Noise Cancellation', 'Apple'),
    ).toBe('Apple AirPods Pro 2');
    expect(cleanBrand('Brand: Nike')).toBe('Nike');
  });
});

describe('applyProfileDiscounts (only user-entered discounts)', () => {
  const profile = UserProfile.parse({
    student: true,
    birthday: '2001-03-15',
    discounts: [
      { label: 'Student 10%', percent: 10, requires: 'student' },
      { label: 'Best Buy member 5%', percent: 5, domains: ['bestbuy.com'] },
      { label: 'Birthday 15%', percent: 15, requires: 'birthday_month' },
    ],
  });

  it('stacks applicable discounts multiplicatively and explains skipped ones', () => {
    const r = applyProfileDiscounts(
      200,
      'www.bestbuy.com',
      profile,
      new Date('2026-11-07T12:00:00Z'),
    );
    expect(r.applied.map((a) => a.label)).toEqual(['Student 10%', 'Best Buy member 5%']);
    expect(r.applied.map((a) => a.savings)).toEqual([20, 9]);
    expect(r.final_price).toBe(171);
    expect(r.skipped).toEqual([{ label: 'Birthday 15%', reason: 'only in your birthday month' }]);
  });

  it('applies birthday discounts in the birthday month and respects domains', () => {
    const r = applyProfileDiscounts(100, 'amazon.com', profile, new Date('2026-03-02T12:00:00Z'));
    expect(r.applied.map((a) => a.label)).toEqual(['Student 10%', 'Birthday 15%']);
    expect(r.skipped[0]!.reason).toBe('only at bestbuy.com');
  });

  it('applies nothing for an empty profile', () => {
    expect(applyProfileDiscounts(50, 'amazon.com', UserProfile.parse({}))).toMatchObject({
      final_price: 50,
      applied: [],
    });
  });
});

function fakeChannel3(results: Channel3Product[]) {
  const products = new Map(results.map((p) => [p.id, structuredClone(p)]));
  const calls = { search: 0, get: 0 };
  const api: Channel3Api = {
    async search() {
      calls.search++;
      return [...products.values()];
    },
    async getProduct(id) {
      calls.get++;
      return products.get(id) ?? null;
    },
  };
  return { api, products, calls };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe('pricing API', () => {
  async function setup(env: Record<string, string> = {}) {
    const c3 = fakeChannel3(XM5_RESULTS);
    const t = await startTestApp({ channel3: c3.api, env: { DEV_ROUTES_ENABLED: 'true', ...env } });
    close = t.close;
    return { t, c3 };
  }

  it('lookup returns comparison, discounts and savings vs the current page price', async () => {
    const { t } = await setup();
    await t.json('PUT', '/api/profile', {
      student: true,
      discounts: [{ label: 'Student 10%', percent: 10, requires: 'student' }],
    });
    const r = await t.json('POST', '/api/pricing/lookup', {
      query: 'Sony WH-1000XM5',
      current_price: 348,
      current_retailer: 'amazon.com',
    });
    expect(r.status).toBe(200);
    expect(r.body.best_offer).toMatchObject({ domain: 'bhphotovideo.com', price: 298 });
    expect(r.body.discounts.best_after_discounts).toMatchObject({
      domain: 'bhphotovideo.com',
      final_price: 268.2,
    });
    expect(r.body.current).toMatchObject({ price: 348, final_price: 313.2 });
    expect(r.body.savings_vs_current).toBe(45);
  });

  it('links Channel3 products to a wishlist item, then the price watch raises a drop alert', async () => {
    const { t, c3 } = await setup();
    const item = await t.json('POST', '/api/wishlist', {
      title: 'Sony WH-1000XM5',
      target_price: 260,
      max_price: 300,
    });
    const first = await t.json('POST', '/api/pricing/lookup', { item_id: item.body.id });
    expect(first.body.alert).toBeNull(); // 298 > target 260, first observation
    expect(
      JSON.parse((await t.json('GET', '/api/wishlist')).body.items[0].channel3_product_ids),
    ).toHaveLength(5);

    // B&H drops to 255 (below target 260).
    c3.products.get('aggqNMU')!.offers[0]!.price.price = 255;
    const run = await t.json('POST', '/api/pricing/refresh');
    expect(run.body).toMatchObject({ checked: 1, alerts: 1, errors: 0 });
    expect(c3.calls.get).toBe(5);
    const alerts = await t.json('GET', '/api/alerts?unseen=true');
    expect(alerts.body.alerts[0]).toMatchObject({
      price: 255,
      retailer: 'bhphotovideo.com',
      item_title: 'Sony WH-1000XM5',
      detail: { hits_target: true, source: 'price_watch' },
    });

    // Same price again: no duplicate alert.
    expect((await t.json('POST', '/api/pricing/refresh')).body.alerts).toBe(0);
    await t.request(`/api/alerts/${alerts.body.alerts[0].id}/seen`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token-0123456789' },
    });
    expect((await t.json('GET', '/api/alerts?unseen=true')).body.alerts).toHaveLength(0);
  });

  it('simulate-price-drop creates a clearly simulated alert, and is hidden when dev routes are off', async () => {
    const { t } = await setup();
    const item = await t.json('POST', '/api/wishlist', {
      title: 'Sony WH-1000XM5',
      target_price: 260,
      max_price: 300,
    });
    await t.json('POST', '/api/pricing/lookup', { item_id: item.body.id });
    const r = await t.json('POST', `/api/dev/simulate-price-drop/${item.body.id}`, {});
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      simulated: true,
      alert: { price: 253.3, retailer: 'bhphotovideo.com', detail: { source: 'simulated' } },
    });
    // Re-runnable for demos.
    expect(
      (await t.json('POST', `/api/dev/simulate-price-drop/${item.body.id}`, { price: 240 })).status,
    ).toBe(201);
    await close!();

    const off = await setup({ DEV_ROUTES_ENABLED: 'false' });
    expect((await off.t.json('POST', '/api/dev/simulate-price-drop/1', {})).status).toBe(404);
  });

  it('validates profile input and returns 503 when Channel3 is not configured', async () => {
    const { t } = await setup();
    expect((await t.json('PUT', '/api/profile', { birthday: 'March 3' })).status).toBe(400);
    expect(
      (await t.json('PUT', '/api/profile', { discounts: [{ label: 'x', percent: 200 }] })).status,
    ).toBe(400);
    expect((await t.json('POST', '/api/pricing/lookup', {})).status).toBe(400);
    await close!();

    const t2 = await startTestApp();
    close = t2.close;
    const r = await t2.json('POST', '/api/pricing/lookup', { query: 'anything' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('not_configured');
  });
});
