import { UserProfile, toCents } from '@fargain/shared';
import { audit } from '../audit.js';
import type { Db } from '../db/index.js';
import { ApiError, notFound } from '../http/errors.js';
import { NOW_SQL, getItem, type WishlistItemRow } from '../store.js';
import type { Channel3Api } from './channel3.js';
import {
  cheaperAlternatives,
  compareOffers,
  lowestEligible,
  type ComparedOffer,
} from './compare.js';
import { applyProfileDiscounts } from './discounts.js';
import { canonicalQuery } from './query.js';
import type { LlmProvider } from '../llm/provider.js';

export interface PricingDeps {
  db: Db;
  userId: number;
  currency: string;
  channel3: () => Channel3Api;
  /** Optional LLM for turning long page titles into search queries; heuristic fallback otherwise. */
  llm?: () => LlmProvider | null;
}

export interface AlertRow {
  id: number;
  item_id: number;
  kind: 'price_drop';
  price: number;
  retailer: string | null;
  url: string | null;
  detail_json: string;
  created_at: string;
  seen_at: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function loadProfile(db: Db, userId: number): UserProfile {
  const row = db.prepare('SELECT profile_json FROM users WHERE id = ?').get(userId) as
    { profile_json: string } | undefined;
  return UserProfile.parse(JSON.parse(row?.profile_json ?? '{}'));
}

export function createPricingService({ db, userId, currency, channel3, llm }: PricingDeps) {
  function snapshot(itemId: number, offer: Pick<ComparedOffer, 'domain' | 'price' | 'url'>) {
    db.prepare(
      'INSERT INTO price_snapshots (item_id, retailer, price, url) VALUES (?, ?, ?, ?)',
    ).run(itemId, offer.domain, offer.price, offer.url);
  }

  /** Lowest snapshot before this one, to detect a new low. */
  function previousLow(itemId: number): number | null {
    const r = db
      .prepare('SELECT MIN(price) AS p FROM price_snapshots WHERE item_id = ?')
      .get(itemId) as { p: number | null };
    return r.p;
  }

  /**
   * Record a price observation and raise an alert when it reaches the item's target price, or is
   * a new low below the previous lowest. One alert per (item, price) to avoid repeats.
   */
  function observe(
    item: WishlistItemRow,
    offer: Pick<ComparedOffer, 'domain' | 'price' | 'url'>,
    source: 'lookup' | 'price_watch' | 'simulated',
  ): AlertRow | null {
    const prevLow = previousLow(item.id);
    snapshot(item.id, offer);
    const hitsTarget =
      item.target_price !== null && toCents(offer.price) <= toCents(item.target_price);
    const newLow = prevLow !== null && toCents(offer.price) < toCents(prevLow);
    if (source !== 'simulated' && !hitsTarget && !newLow) return null;
    if (item.status === 'purchased' || item.status === 'archived') return null;
    const dup = db
      .prepare("SELECT id FROM alerts WHERE item_id = ? AND kind = 'price_drop' AND price = ?")
      .get(item.id, offer.price);
    if (dup) return null;
    const detail = {
      previous_low: prevLow,
      target_price: item.target_price,
      hits_target: hitsTarget,
      source,
    };
    const id = Number(
      db
        .prepare(
          "INSERT INTO alerts (user_id, item_id, kind, price, retailer, url, detail_json) VALUES (?, ?, 'price_drop', ?, ?, ?, ?)",
        )
        .run(userId, item.id, offer.price, offer.domain, offer.url, JSON.stringify(detail))
        .lastInsertRowid,
    );
    audit(db, {
      userId,
      actor: 'system',
      action: 'pricing.price_drop_alert',
      detail: {
        item_id: item.id,
        alert_id: id,
        price: offer.price,
        retailer: offer.domain,
        ...detail,
      },
    });
    return db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as AlertRow;
  }

  async function lookup(input: {
    query?: string;
    productTitle?: string;
    brand?: string;
    itemId?: number;
    currentPrice?: number;
    currentRetailer?: string;
  }) {
    const item = input.itemId !== undefined ? getItem(db, userId, input.itemId) : undefined;
    if (input.itemId !== undefined && !item) throw notFound('wishlist item');
    const client = channel3(); // 503 when not configured
    let query: string;
    let querySource: 'given' | 'llm' | 'heuristic';
    if (input.query) {
      query = input.query;
      querySource = 'given';
    } else {
      const c = await canonicalQuery(
        input.productTitle ?? item!.title,
        input.brand,
        llm?.() ?? null,
      );
      query = c.query;
      querySource = c.source;
    }
    const products = await client.search(query, 30);
    const comparison = compareOffers(query, products, currency);
    const alternatives = cheaperAlternatives(query, products, {
      categorySlug: comparison.category?.slug ?? null,
      belowPrice: comparison.best_offer?.price ?? input.currentPrice ?? null,
      currency,
    });
    const profile = loadProfile(db, userId);
    const withDiscounts = comparison.offers
      .filter((o) => !o.excluded)
      .map((o) => ({ domain: o.domain, ...applyProfileDiscounts(o.price, o.domain, profile) }));
    const current =
      input.currentPrice !== undefined
        ? {
            price: input.currentPrice,
            retailer: input.currentRetailer ?? null,
            ...applyProfileDiscounts(input.currentPrice, input.currentRetailer ?? '', profile),
          }
        : null;
    const bestAfterDiscounts =
      [...withDiscounts].sort((a, b) => a.final_price - b.final_price)[0] ?? null;
    const savingsVsCurrent =
      current && bestAfterDiscounts
        ? round2(Math.max(0, current.final_price - bestAfterDiscounts.final_price))
        : null;

    let alert: AlertRow | null = null;
    if (item) {
      const ids = comparison.matched_products.map((p) => p.id).slice(0, 10);
      if (ids.length) {
        db.prepare(
          `UPDATE wishlist_items SET channel3_product_ids = ?, updated_at = ${NOW_SQL} WHERE id = ?`,
        ).run(JSON.stringify(ids), item.id);
      }
      if (comparison.best_offer) alert = observe(item, comparison.best_offer, 'lookup');
    }
    audit(db, {
      userId,
      actor: 'system',
      action: 'pricing.lookup',
      detail: {
        query,
        item_id: item?.id ?? null,
        matched: comparison.matched_products.length,
        offers_used: comparison.offer_count_used,
        best: comparison.best_offer
          ? { domain: comparison.best_offer.domain, price: comparison.best_offer.price }
          : null,
        fair_price: comparison.fair_price,
      },
    });
    return {
      ...comparison,
      query_source: querySource,
      alternatives,
      discounts: {
        profile_discounts: profile.discounts.length,
        offers: withDiscounts,
        best_after_discounts: bestAfterDiscounts,
      },
      current,
      savings_vs_current: savingsVsCurrent,
      alert,
    };
  }

  /** Refresh one item via the free GET /v1/products/{id}. Returns the alert raised, if any. */
  async function refreshItem(
    item: WishlistItemRow,
  ): Promise<{ checked: boolean; lowest: ComparedOffer | null; alert: AlertRow | null }> {
    const ids = JSON.parse(item.channel3_product_ids || '[]') as string[];
    if (!ids.length) return { checked: false, lowest: null, alert: null };
    const client = channel3();
    const products = (await Promise.all(ids.map((id) => client.getProduct(id)))).filter(
      (p) => p !== null,
    );
    const lowest = lowestEligible(products, currency);
    return { checked: true, lowest, alert: lowest ? observe(item, lowest, 'price_watch') : null };
  }

  async function runPriceWatch(): Promise<{ checked: number; alerts: number; errors: number }> {
    const items = db
      .prepare(
        "SELECT * FROM wishlist_items WHERE user_id = ? AND status IN ('watching','negotiating') AND channel3_product_ids != '[]'",
      )
      .all(userId) as WishlistItemRow[];
    let checked = 0;
    let alerts = 0;
    let errors = 0;
    for (const item of items) {
      try {
        const r = await refreshItem(item);
        if (r.checked) checked++;
        if (r.alert) alerts++;
      } catch {
        errors++;
      }
    }
    audit(db, {
      userId,
      actor: 'system',
      action: 'pricing.price_watch_run',
      detail: { items: items.length, checked, alerts, errors },
    });
    return { checked, alerts, errors };
  }

  /** Demo helper: pretend a retailer dropped its price. Clearly marked as simulated everywhere. */
  function simulateDrop(itemId: number, price?: number): AlertRow {
    const item = getItem(db, userId, itemId);
    if (!item) throw notFound('wishlist item');
    const last = db
      .prepare(
        'SELECT retailer, price, url FROM price_snapshots WHERE item_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(itemId) as { retailer: string; price: number; url: string | null } | undefined;
    const base = last?.price ?? item.target_price ?? item.max_price ?? 100;
    let newPrice = price ?? round2(base * 0.85);
    if (price === undefined && item.target_price !== null)
      newPrice = Math.min(newPrice, item.target_price);
    // Clear an existing alert at this exact price so the demo can be re-run.
    db.prepare(
      "DELETE FROM alerts WHERE item_id = ? AND price = ? AND json_extract(detail_json, '$.source') = 'simulated'",
    ).run(itemId, newPrice);
    const alert = observe(
      item,
      {
        domain: last?.retailer ?? 'simulated-retailer.example',
        price: newPrice,
        url: last?.url ?? null,
      },
      'simulated',
    );
    if (!alert) throw new ApiError(409, 'item_closed', `item is ${item.status}; no alert raised`);
    return alert;
  }

  function listAlerts(onlyUnseen: boolean): (AlertRow & { item_title: string })[] {
    return db
      .prepare(
        `SELECT a.*, i.title AS item_title FROM alerts a JOIN wishlist_items i ON i.id = a.item_id
         WHERE a.user_id = ? ${onlyUnseen ? 'AND a.seen_at IS NULL' : ''} ORDER BY a.id DESC LIMIT 50`,
      )
      .all(userId) as (AlertRow & { item_title: string })[];
  }

  return { lookup, refreshItem, runPriceWatch, simulateDrop, listAlerts };
}

export type PricingService = ReturnType<typeof createPricingService>;
