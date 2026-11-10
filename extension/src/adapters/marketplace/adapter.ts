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

/** Not hidden by attribute, aria-hidden ancestor, or computed display/visibility. */
export function isVisible(el: HTMLElement, win: Window): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const cs = win.getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

/**
 * Levels up to the nearest ancestor containing a compose hint, or Infinity if none within
 * S.chat.hintDepth. Smaller is closer: a shared outer container (e.g. role=main) contains the hint
 * for every textarea, so "contains a hint" alone cannot tell boxes apart.
 */
export function hintDistance(el: Element): number {
  let n: Element | null = el.parentElement;
  for (let depth = 1; n && depth <= S.chat.hintDepth; depth++, n = n.parentElement) {
    // Stop at containers shared with other text boxes: a hint there is not specific to this box.
    if (n.querySelectorAll(S.chat.editableProbe).length > 1) return Infinity;
    const t = n.textContent ?? '';
    if (S.chat.composeHints.some((h) => t.includes(h))) return depth;
  }
  return Infinity;
}

export const nearHint = (el: Element): boolean => hintDistance(el) !== Infinity;

/**
 * Structural description of up to 5 text boxes on the page, e.g.
 * "textarea | in main | aria-label=Send seller a message". Never includes the box's value.
 */
export function describeEditables(doc: Document): Record<string, string | number> {
  const clip = (s: string | null) => (s ? s.replace(/\s+/g, ' ').slice(0, 40) : '');
  const els = [...doc.querySelectorAll<HTMLElement>(S.chat.editableProbe)];
  const out: Record<string, string | number> = { editables: els.length };
  els.slice(0, 5).forEach((el, i) => {
    const where = el.closest('[role="dialog"]')
      ? 'in dialog'
      : el.closest('[role="main"]')
        ? 'in main'
        : 'outside main';
    const parts = [
      el.tagName.toLowerCase(),
      where,
      el.getAttribute('role') ? `role=${el.getAttribute('role')}` : '',
      el.getAttribute('contenteditable')
        ? `contenteditable=${el.getAttribute('contenteditable')}`
        : '',
      el.getAttribute('aria-label') ? `aria-label=${clip(el.getAttribute('aria-label'))}` : '',
      el.getAttribute('placeholder') ? `placeholder=${clip(el.getAttribute('placeholder'))}` : '',
      isVisible(el, doc.defaultView ?? window) ? 'visible' : 'hidden',
      Number.isFinite(hintDistance(el)) ? `hint ${hintDistance(el)} up` : 'no hint',
      // Only whether a value exists, never the value itself.
      'value' in el && (el as HTMLTextAreaElement).value ? 'has text' : 'empty',
    ].filter(Boolean);
    out[`editable_${i + 1}`] = parts.join(' | ');
  });
  return out;
}

export function createMarketplaceAdapter(doc: Document = document): SiteAdapter {
  const win = doc.defaultView ?? window;
  const onFacebook = () => (S.hosts as readonly string[]).includes(win.location.hostname);
  const isItemPage = () => S.itemPath.test(win.location.pathname);
  const isThreadPage = () => S.threadPath.test(win.location.pathname);
  const chatContainer = () => firstMatch(doc, S.chat.container);
  /**
   * For each compose selector (in order), collect all matches; choose a visible match near a hint
   * ("Send seller a message"), else the first visible match. Falls through to the next selector
   * only if nothing visible matched.
   */
  const compose = (): { el: Element; selector: string } | null => {
    for (const selector of S.chat.compose) {
      const visible = [...doc.querySelectorAll<HTMLElement>(selector)].filter((el) =>
        isVisible(el, win),
      );
      if (!visible.length) continue;
      // Closest to a hint wins; ties keep document order.
      let best = visible[0]!;
      let bestDist = hintDistance(best);
      for (const el of visible.slice(1)) {
        const d = hintDistance(el);
        if (d < bestDist) {
          best = el;
          bestDist = d;
        }
      }
      return { el: best, selector: bestDist !== Infinity ? `${selector} (near hint)` : selector };
    }
    return null;
  };

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
        dialogs: doc.querySelectorAll('[role="dialog"]').length,
        ...describeEditables(doc),
      };
    },
  };
}
