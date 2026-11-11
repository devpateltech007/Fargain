import type { Channel3Offer, Channel3Product } from './channel3.js';

/**
 * Pure comparison logic over Channel3 search results. Written against live data quirks:
 *  - the same physical product appears as several Channel3 products (1 offer each), so offers are
 *    pooled across all exact matches and de-duplicated by retailer domain;
 *  - searches return near-misses (AirPods Max for "AirPods Pro 2"), so "exact" requires every
 *    significant query token to appear in the title;
 *  - some offers are implausible (Air Force 1 at $10, compare-at $115) or from non-US stores priced
 *    in USD (footlocker.ca); both are shown but excluded from best price and fair price.
 */

export interface ComparedOffer {
  domain: string;
  price: number;
  compare_at_price: number | null;
  currency: string;
  url: string | null;
  in_stock: boolean;
  condition: string | null;
  product_id: string;
  product_title: string;
  /** Why this offer is excluded from best/fair price, if it is. */
  excluded: null | 'non_us_store' | 'suspiciously_low' | 'out_of_stock' | 'other_currency' | 'used';
}

export interface Alternative {
  product_id: string;
  title: string;
  brand: string | null;
  lowest_price: number;
  domain: string;
  url: string | null;
  image_url: string | null;
}

export interface Comparison {
  query: string;
  matched_products: { id: string; title: string; brand: string | null; image_url: string | null }[];
  offers: ComparedOffer[];
  best_offer: ComparedOffer | null;
  fair_price: number | null;
  offer_count_used: number;
  category: { slug: string; title: string } | null;
}

const STOP = new Set(['the', 'and', 'with', 'for', 'new', 'a', 'an', 'of', 'in', '-', '&']);

/** Lowercase, drop apostrophes, join hyphenated model numbers ("WH-1000XM5" -> "wh1000xm5"). */
export function normalize(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/(\w)-(\w)/g, '$1$2')
      // "2nd Generation" means the same as "2" (live: "AirPods Pro 2nd Generation" vs "AirPods Pro 2")
      .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, '$1')
      .replace(/\b(?:generation|gen)\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  );
}

export function tokens(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t && !STOP.has(t));
}

const brandOf = (p: Channel3Product) => p.brands?.[0]?.name ?? null;
const imageOf = (p: Channel3Product) =>
  p.images?.find((i) => i.is_main_image)?.url ?? p.images?.[0]?.url ?? null;

/** Every query token must appear as a whole token in the title (brand tokens may come from `brands`). */
export function isExactMatch(query: string, p: Channel3Product): boolean {
  const q = tokens(query);
  if (!q.length) return false;
  const have = new Set([...tokens(p.title), ...tokens(brandOf(p) ?? '')]);
  return q.every((t) => have.has(t));
}

/** Marketplaces that mainly sell used/refurbished goods (live: backmarket.com appeared as "best"). */
export const SECONDHAND_DOMAINS = [
  'backmarket.com',
  'ebay.com',
  'swappa.com',
  'mercari.com',
  'poshmark.com',
  'decluttr.com',
];
const isSecondhand = (domain: string) =>
  SECONDHAND_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));

/** Store TLDs treated as US for a USD comparison. */
export function isUsStore(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    /\.(com|us|net|org|shop|store|co)$/.test(d) && !/\.(co\.uk|com\.au|com\.mx|com\.br)$/.test(d)
  );
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function toCompared(o: Channel3Offer, p: Channel3Product, currency: string): ComparedOffer {
  const inStock = !o.availability || /instock|in_stock|limited/i.test(o.availability);
  const used =
    Boolean(o.condition && !/new/i.test(o.condition)) || isSecondhand(o.domain.toLowerCase());
  return {
    domain: o.domain,
    price: o.price.price,
    compare_at_price: o.price.compare_at_price ?? null,
    currency: o.price.currency,
    url: o.url ?? null,
    in_stock: inStock,
    condition: o.condition ?? null,
    product_id: p.id,
    product_title: p.title,
    excluded:
      o.price.currency !== currency
        ? 'other_currency'
        : !inStock
          ? 'out_of_stock'
          : used
            ? 'used'
            : !isUsStore(o.domain)
              ? 'non_us_store'
              : null,
  };
}

/** Offers below this fraction of the median of eligible offers are treated as data errors. */
export const SUSPICIOUS_FRACTION = 0.4;

export function compareOffers(
  query: string,
  products: Channel3Product[],
  currency = 'USD',
): Comparison {
  const exact = products.filter((p) => isExactMatch(query, p));
  // Lowest offer per retailer domain across all exact matches.
  const byDomain = new Map<string, ComparedOffer>();
  for (const p of exact) {
    for (const o of p.offers) {
      const c = toCompared(o, p, currency);
      const prev = byDomain.get(c.domain);
      if (
        !prev ||
        (prev.excluded && !c.excluded) ||
        (!!prev.excluded === !!c.excluded && c.price < prev.price)
      ) {
        byDomain.set(c.domain, c);
      }
    }
  }
  const offers = [...byDomain.values()];
  const eligible = () => offers.filter((o) => !o.excluded);
  const med = median(eligible().map((o) => o.price));
  if (med !== null) {
    for (const o of offers)
      if (!o.excluded && o.price < med * SUSPICIOUS_FRACTION) o.excluded = 'suspiciously_low';
  }
  const used = eligible().sort((a, b) => a.price - b.price);
  offers.sort((a, b) => Number(!!a.excluded) - Number(!!b.excluded) || a.price - b.price);
  const fair = median(used.map((o) => o.price));
  return {
    query,
    matched_products: exact.map((p) => ({
      id: p.id,
      title: p.title,
      brand: brandOf(p),
      image_url: imageOf(p),
    })),
    offers,
    best_offer: used[0] ?? null,
    fair_price: fair === null ? null : round2(fair),
    offer_count_used: used.length,
    category: exact[0]?.category
      ? { slug: exact[0].category.slug, title: exact[0].category.title }
      : null,
  };
}

/** Cheaper products in the same category that are not the searched item. */
export function cheaperAlternatives(
  query: string,
  products: Channel3Product[],
  opts: {
    categorySlug: string | null;
    belowPrice: number | null;
    currency?: string;
    limit?: number;
  },
): Alternative[] {
  if (opts.belowPrice === null) return [];
  const currency = opts.currency ?? 'USD';
  const floor = opts.belowPrice * SUSPICIOUS_FRACTION;
  const out: Alternative[] = [];
  const seenTitles = new Set<string>();
  for (const p of products) {
    if (isExactMatch(query, p)) continue;
    if (opts.categorySlug && p.category?.slug !== opts.categorySlug) continue;
    const best = p.offers
      .map((o) => toCompared(o, p, currency))
      .filter((o) => !o.excluded && o.price < opts.belowPrice! && o.price >= floor)
      .sort((a, b) => a.price - b.price)[0];
    if (!best) continue;
    const key = normalize(p.title);
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    out.push({
      product_id: p.id,
      title: p.title,
      brand: brandOf(p),
      lowest_price: best.price,
      domain: best.domain,
      url: best.url,
      image_url: imageOf(p),
    });
  }
  return out.sort((a, b) => a.lowest_price - b.lowest_price).slice(0, opts.limit ?? 5);
}

/** Lowest eligible offer across the given products (used by the price watch). */
export function lowestEligible(
  products: Channel3Product[],
  currency = 'USD',
): ComparedOffer | null {
  const all = products
    .flatMap((p) => p.offers.map((o) => toCompared(o, p, currency)))
    .filter((o) => !o.excluded);
  const med = median(all.map((o) => o.price));
  return (
    all
      .filter((o) => med === null || o.price >= med * SUSPICIOUS_FRACTION)
      .sort((a, b) => a.price - b.price)[0] ?? null
  );
}
