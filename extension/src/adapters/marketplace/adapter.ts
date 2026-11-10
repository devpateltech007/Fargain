import { fillComposeBox, firstMatch, observe, parsePrice, watchUrl } from '../dom';
import type { ConversationMessage, Listing, SiteAdapter } from '../types';
import { MARKETPLACE as S } from './selectors';

/** Canonical listing URL, so the item page and its chat thread map to the same negotiation. */
export function canonicalItemUrl(href: string, base = 'https://www.facebook.com'): string | null {
  try {
    const u = new URL(href, base);
    const m = u.pathname.match(S.itemPath);
    return m ? `https://www.facebook.com/marketplace/item/${m[1]}/` : null;
  } catch {
    return null;
  }
}

const PRICE_RE = /^(?:US)?\$\s?\d[\d,]*(?:\.\d{1,2})?$|^free$/i;

function currencyOf(raw: string): string | undefined {
  return /\$/.test(raw) ? 'USD' : undefined;
}

/** Text following a heading/label like "Description" within the same section, best effort. */
function textAfterLabel(root: ParentNode, labels: readonly string[]): string | undefined {
  const spans = [...root.querySelectorAll<HTMLElement>('span, h2, h3, div[dir="auto"]')];
  for (const label of labels) {
    const idx = spans.findIndex((s) => s.textContent?.trim().toLowerCase() === label.toLowerCase());
    if (idx === -1) continue;
    for (const next of spans.slice(idx + 1, idx + 8)) {
      const t = next.textContent?.trim();
      if (t && t.toLowerCase() !== label.toLowerCase() && !labels.includes(t)) return t;
    }
  }
  return undefined;
}

export function createMarketplaceAdapter(doc: Document = document): SiteAdapter {
  const win = doc.defaultView ?? window;
  const onFacebook = () => (S.hosts as readonly string[]).includes(win.location.hostname);
  const isItemPage = () => S.itemPath.test(win.location.pathname);
  const isThreadPage = () => S.threadPath.test(win.location.pathname);
  const chatContainer = () => firstMatch(doc, S.chat.container);
  const compose = () => firstMatch(doc, S.chat.compose);

  function readListingFromItemPage(): Listing | null {
    const url = canonicalItemUrl(win.location.href);
    if (!url) return null;
    const title =
      firstMatch(doc, S.listing.title)?.el.textContent?.trim() ||
      doc.title
        .replace(/^\(\d+\)\s*/, '')
        .replace(/^Marketplace\s*[-–]\s*/, '')
        .replace(/\s*\|\s*Facebook$/, '')
        .trim();
    if (!title) return null;

    let price: number | undefined;
    let currency: string | undefined;
    for (const sel of S.listing.priceCandidates) {
      const hit = [...doc.querySelectorAll(sel)]
        .map((e) => e.textContent?.trim() ?? '')
        .find((t) => PRICE_RE.test(t));
      if (hit) {
        price = /^free$/i.test(hit) ? 0 : parsePrice(hit);
        currency = currencyOf(hit) ?? (price === 0 ? 'USD' : undefined);
        break;
      }
    }

    const seller = firstMatch(doc, S.listing.sellerLink)?.el.textContent?.trim() || undefined;
    const img = firstMatch<HTMLImageElement>(doc, S.listing.image)?.el;
    const attributes: Record<string, string> = {};
    const condition = textAfterLabel(doc, S.listing.conditionLabels);
    const location = textAfterLabel(doc, S.listing.locationLabels);
    if (condition) attributes.condition = condition.slice(0, 100);
    if (location) attributes.location = location.slice(0, 100);
    const description = textAfterLabel(doc, S.listing.descriptionHeadings);

    return {
      title: title.slice(0, 300),
      url,
      price,
      currency,
      sellerLabel: seller,
      imageUrl: img?.src || undefined,
      description: description?.slice(0, 5000),
      attributes,
    };
  }

  /** On a chat thread, the listing is the item linked in the header. */
  function readListingFromThread(): Listing | null {
    const link = firstMatch<HTMLAnchorElement>(doc, S.chat.listingLink)?.el;
    const url = link ? canonicalItemUrl(link.getAttribute('href') ?? '') : null;
    if (!url) return null;
    const label = link!.textContent?.trim() ?? '';
    // Header links often read "Title · $150"; split off a trailing price if present.
    const m = label.match(/^(.*?)\s*[·•-]\s*((?:US)?\$\s?[\d,]+(?:\.\d{1,2})?)\s*$/);
    return {
      title: (m ? m[1]! : label || 'Marketplace listing').slice(0, 300),
      url,
      price: m ? parsePrice(m[2]) : undefined,
      currency: m ? 'USD' : undefined,
    };
  }

  function readConversation(): ConversationMessage[] {
    const c = chatContainer();
    if (!c) return [];
    const rows = [...c.el.querySelectorAll<HTMLElement>(S.chat.row.join(','))];
    const out: ConversationMessage[] = [];
    for (const row of rows) {
      const text = firstMatch<HTMLElement>(row, S.chat.text)?.el.textContent?.trim();
      if (!text) continue;
      const all = row.textContent ?? '';
      const mine = S.chat.ownMessageMarkers.some((m) => all.includes(m));
      out.push({ role: mine ? 'buyer' : 'seller', text: text.slice(0, 4000) });
    }
    return out;
  }

  return {
    id: 'facebook_marketplace',
    detect: () => onFacebook() && (isItemPage() || isThreadPage()),

    getListing: () =>
      isItemPage() ? readListingFromItemPage() : isThreadPage() ? readListingFromThread() : null,

    getConversation: () => readConversation(),

    insertMessage(value: string): boolean {
      const box = compose();
      return box ? fillComposeBox(box.el, value) : false;
    },

    onChange(cb) {
      if (!onFacebook()) return () => undefined;
      // Facebook is a SPA. Always watch the URL (cheap); observe the DOM only while on a
      // Marketplace item or chat page, so the rest of Facebook is untouched.
      let stopDom: (() => void) | undefined;
      const sync = () => {
        const relevant = isItemPage() || isThreadPage();
        if (relevant && !stopDom) stopDom = observe(doc.body, cb, 800);
        if (!relevant && stopDom) {
          stopDom();
          stopDom = undefined;
        }
      };
      sync();
      const stopUrl = watchUrl(win, () => {
        sync();
        cb();
      });
      return () => {
        stopUrl();
        stopDom?.();
      };
    },

    diagnose() {
      const listing = isItemPage()
        ? readListingFromItemPage()
        : isThreadPage()
          ? readListingFromThread()
          : null;
      return {
        on_facebook: onFacebook(),
        page: isItemPage() ? 'item' : isThreadPage() ? 'thread' : 'other',
        title_selector: firstMatch(doc, S.listing.title)?.selector ?? 'none',
        price_found: listing?.price !== undefined,
        seller_found: Boolean(listing?.sellerLabel),
        chat_container: chatContainer()?.selector ?? 'none',
        chat_rows: readConversation().length,
        compose_box: compose()?.selector ?? 'none',
      };
    },
  };
}
