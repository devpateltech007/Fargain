import { firstMatch, observe, parsePrice, watchUrl } from '../dom';
import type { Listing, SiteAdapter } from '../types';
import { AMAZON as S } from './selectors';

/** ASIN from the URL path, else from the hidden ASIN input. */
export function asinOf(doc: Document): string | null {
  const m = doc.location.pathname.match(S.asinPath);
  if (m) return m[1]!;
  const input = firstMatch<HTMLInputElement>(doc, S.asinInput)?.el;
  return input?.value && /^[A-Z0-9]{10}$/.test(input.value) ? input.value : null;
}

/**
 * Amazon product pages. Read-only: there is no chat, so getConversation() is empty and
 * insertMessage() always returns false. No login, no cart or checkout interaction.
 */
export function createAmazonAdapter(doc: Document = document): SiteAdapter {
  const win = doc.defaultView ?? window;
  const onAmazon = () => (S.hosts as readonly string[]).includes(win.location.hostname);
  const title = () =>
    firstMatch(doc, S.title)?.el.textContent?.replace(/\s+/g, ' ').trim() || undefined;

  function readListing(): Listing | null {
    const asin = asinOf(doc);
    const t = title();
    if (!asin || !t) return null;
    const priceHit = firstMatch(doc, S.price);
    const priceText = priceHit?.el.textContent?.trim();
    const brand = firstMatch(doc, S.brand)?.el.textContent?.replace(/\s+/g, ' ').trim();
    const img = firstMatch<HTMLImageElement>(doc, S.image)?.el;
    return {
      title: t.slice(0, 300),
      url: `https://www.amazon.com/dp/${asin}`,
      price: parsePrice(priceText),
      currency: priceText?.includes('$') ? 'USD' : undefined,
      sellerLabel: 'amazon.com',
      imageUrl: img?.getAttribute('src') || undefined,
      attributes: { asin, ...(brand ? { brand: brand.slice(0, 100) } : {}) },
    };
  }

  return {
    id: 'amazon',
    detect: () => onAmazon() && asinOf(doc) !== null && title() !== undefined,
    getListing: readListing,
    getConversation: () => [],
    insertMessage: () => false,
    onChange(cb) {
      if (!onAmazon()) return () => undefined;
      const root = firstMatch(doc, S.changeRoot)?.el ?? doc.body;
      const stopDom = observe(root, cb, 1000);
      const stopUrl = watchUrl(win, cb);
      return () => {
        stopDom();
        stopUrl();
      };
    },
    diagnose() {
      const l = readListing();
      return {
        on_amazon: onAmazon(),
        asin_found: asinOf(doc) !== null,
        title_selector: firstMatch(doc, S.title)?.selector ?? 'none',
        price_selector: firstMatch(doc, S.price)?.selector ?? 'none',
        price_found: l?.price !== undefined,
        brand_found: Boolean(l?.attributes?.brand),
      };
    },
  };
}
