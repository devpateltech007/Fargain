import { toCents, type RiskFlag } from '@fargain/shared';

/**
 * Deterministic guardrails around the negotiation agent. These do not depend on the LLM:
 *
 * 1. The max price is never sent to the LLM (see prompts.ts), so the model cannot leak it.
 * 2. Every draft is checked before the user sees it: no money amount above max_price, no
 *    budget-disclosure phrasing, no agreeing to off-platform payment.
 * 3. Seller messages are scanned for off-platform payment and common scam patterns; these
 *    flags are merged with (never replaced by) whatever the LLM reports.
 */

// ---------------------------------------------------------------------------------------------
// Money extraction

/**
 * Pull money amounts out of free text. Matches "$85", "85 dollars", "85 bucks", "USD 85",
 * "85.50", "1,200" and bare numbers that look like prices (2+ digits) in a price context.
 * Deliberately over-inclusive: a false positive only blocks a draft, a false negative could
 * leak or exceed the budget.
 */
const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const EXPLICIT = [
  new RegExp(String.raw`(?:\$|\busd\s?|\bus\$)\s?${NUM}`, 'gi'),
  new RegExp(String.raw`${NUM}\s?(?:dollars?|bucks|usd)\b`, 'gi'),
];
// Standalone numbers only: not part of a model number ("WH-1000XM5"), time ("5:30") or decimal.
const BARE = new RegExp(String.raw`(?<![\w$.,:/-])${NUM}(?![\w-]|[.,:]\d)`, 'g');

const toValue = (int: string, dec?: string) =>
  Number(int.replace(/,/g, '')) + (dec ? Number(`0.${dec.padEnd(2, '0')}`) : 0);

export function extractAmounts(text: string): number[] {
  const out: number[] = [];
  const covered: [number, number][] = [];
  for (const re of EXPLICIT) {
    for (const m of text.matchAll(re)) {
      out.push(toValue(m[1]!, m[2]));
      covered.push([m.index, m.index + m[0].length]);
    }
  }
  for (const m of text.matchAll(BARE)) {
    if (covered.some(([s, e]) => m.index >= s && m.index < e)) continue;
    const value = toValue(m[1]!, m[2]);
    // Small counts ("2 days") and years ("2023 model") are not prices.
    if (value < 10) continue;
    if (!m[2] && value >= 1900 && value <= 2100) continue;
    out.push(value);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Risk detection on seller text

interface Pattern {
  code: RiskFlag['code'];
  re: RegExp;
  detail: string;
}

const SELLER_PATTERNS: Pattern[] = [
  {
    code: 'off_platform_payment',
    re: /\b(zelle|venmo|cash\s?app|\$cashtag|western\s?union|money\s?gram|wire\s+transfer|bank\s+transfer|crypto|bitcoin|btc|usdt|ethereum|apple\s?cash|chime)\b/i,
    detail:
      'Seller asks for a payment method outside PayPal / the platform, which has no buyer protection.',
  },
  {
    code: 'off_platform_payment',
    re: /\b(friends?\s*(and|&|n)\s*family|f\s*&\s*f|\bf&f\b|gift\s*cards?|itunes\s+cards?|steam\s+cards?)\b/i,
    detail:
      'Seller asks for Friends & Family or gift-card payment, which removes buyer protection.',
  },
  {
    code: 'off_platform_payment',
    re: /\b(whats\s?app|telegram|text\s+me|email\s+me|my\s+(email|number|cell)|off\s+(of\s+)?(facebook|marketplace|the\s+app))\b|[\w.+-]+@[\w-]+\.[a-z]{2,}|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/i,
    detail: 'Seller tries to move the conversation off-platform (phone, email, or another app).',
  },
  {
    code: 'personal_info_request',
    re: /\b(verification|verify|confirm(ation)?)\s+code\b|\b(6|six)[-\s]digit\b|\bgoogle\s+voice\b|\b(ssn|social\s+security|password|pin)\b/i,
    detail: 'Seller asks for a verification code or personal data (common account-takeover scam).',
  },
  {
    code: 'shipping_or_overpayment_scam',
    re: /\b(overpa(y|id|yment)|shipping\s+agent|courier\s+(will|to)\s+pick|send\s+(you\s+)?(the\s+)?(difference|extra)|refund\s+the\s+(rest|difference)|prepaid\s+label)\b/i,
    detail: 'Overpayment / shipping-agent pattern typical of marketplace scams.',
  },
  {
    code: 'pressure_tactics',
    re: /\b(deposit\s+to\s+hold|pay\s+(first|upfront|up\s+front|before)|(other|another)\s+buyers?\s+(waiting|lined\s+up|interested)|today\s+only|right\s+now\s+or)\b/i,
    detail: 'Seller pushes for upfront payment or uses urgency pressure.',
  },
  {
    code: 'max_price_probe',
    re: /\b(what('?s| is)\s+your\s+(budget|max|maximum|best|highest)|how\s+much\s+(can|will|would)\s+you\s+(pay|spend|go)|what('?s| is)\s+the\s+most\s+you)\b/i,
    detail: 'Seller is probing for your budget. The agent will not disclose it.',
  },
];

export function detectSellerRisks(text: string): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const seen = new Set<string>();
  for (const p of SELLER_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const key = `${p.code}:${p.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({ code: p.code, detail: `${p.detail} (matched "${m[0].trim().slice(0, 40)}")` });
  }
  return flags;
}

/** Union of deterministic and LLM flags, de-duplicated by code+detail. */
export function mergeFlags(...lists: RiskFlag[][]): RiskFlag[] {
  const out: RiskFlag[] = [];
  const seen = new Set<string>();
  for (const f of lists.flat()) {
    const key = `${f.code}|${f.detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Draft checks

export type DraftViolation =
  | { code: 'offer_above_max'; detail: string }
  | { code: 'amount_above_max'; detail: string }
  | { code: 'reveals_budget'; detail: string }
  | { code: 'agrees_off_platform'; detail: string }
  | { code: 'opening_too_high'; detail: string };

// ---------------------------------------------------------------------------------------------
// Opening-offer discipline (live test: the model opened at the user's ceiling, leaving no room)

/**
 * The suggested opening offer may not exceed the asking price, the buyer's target price, or the
 * max price. Rounded down to whole dollars so it reads naturally.
 */
export function clampOpeningOffer(
  suggested: number,
  limits: { askingPrice: number | null; targetPrice: number | null; maxPrice: number | null },
): number {
  const caps = [suggested, limits.askingPrice, limits.targetPrice, limits.maxPrice].filter(
    (n): n is number => n !== null && Number.isFinite(n),
  );
  return Math.floor(Math.min(...caps));
}

/** True if any message the buyer actually sent contains a price amount. */
export function buyerHasOffered(history: { role: string; text: string }[]): boolean {
  return history.some((m) => m.role === 'buyer_sent' && extractAmounts(m.text).length > 0);
}

/**
 * Before the buyer has named any price, the first offer must not exceed the suggested opening.
 * The opening is always <= max_price, so naming it in retry feedback does not leak the max.
 */
export function checkOpeningOffer(input: {
  proposedOffer: number | null;
  openingOffer: number;
  buyerHasOffered: boolean;
}): DraftViolation[] {
  if (input.buyerHasOffered || input.proposedOffer === null) return [];
  if (toCents(input.proposedOffer) <= toCents(input.openingOffer)) return [];
  return [
    {
      code: 'opening_too_high',
      detail: `This is the first offer: open at or below ${input.openingOffer.toFixed(2)} to leave room to negotiate.`,
    },
  ];
}

const BUDGET_DISCLOSURE =
  /\b(my|our)\s+(budget|max(imum)?|limit|ceiling|cap)\b|\b(max(imum)?|top|highest)\s+(i|we)\s+(can|could|will|would)\b|\bmost\s+(i|we)\s+(can|could|will|would)\s+(pay|spend|do|go)\b|\b(i|we)\s+(can'?t|cannot|won'?t)\s+go\s+(above|over|higher\s+than)\b|\bup\s+to\s+\$?\d/i;

const BUYER_OFF_PLATFORM =
  /\b(zelle|venmo|cash\s?app|western\s?union|money\s?gram|wire(\s+transfer)?|bank\s+transfer|crypto|bitcoin|gift\s*cards?|friends?\s*(and|&)\s*family|whats\s?app|telegram|text\s+me|my\s+(number|email))\b/i;
/** A sentence that mentions e.g. Zelle is fine if it is declining it ("I'd rather not use Zelle"). */
const REFUSAL_CUE =
  /\b(not|no|don'?t|do\s+not|can'?t|cannot|won'?t|rather|instead|prefer|only|stick|keep\s+it)\b/i;

function proposesOffPlatform(text: string): boolean {
  return text
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => BUYER_OFF_PLATFORM.test(sentence) && !REFUSAL_CUE.test(sentence));
}

export interface DraftCheckInput {
  draftMessage: string;
  proposedOffer: number | null;
  maxPrice: number | null;
}

/**
 * Validate a buyer-side message (LLM draft or user-edited text) before it can be inserted.
 * Any amount above max_price is a violation, so the agent can never offer more than the cap.
 * Budget-disclosure phrasing is a violation regardless of the number used.
 */
export function checkBuyerMessage({
  draftMessage,
  proposedOffer,
  maxPrice,
}: DraftCheckInput): DraftViolation[] {
  const v: DraftViolation[] = [];
  if (maxPrice !== null) {
    const capCents = toCents(maxPrice);
    if (proposedOffer !== null && toCents(proposedOffer) > capCents) {
      v.push({ code: 'offer_above_max', detail: 'proposed offer is above your max price' });
    }
    if (extractAmounts(draftMessage).some((a) => toCents(a) > capCents)) {
      v.push({
        code: 'amount_above_max',
        detail: 'message mentions an amount above your max price',
      });
    }
  }
  if (BUDGET_DISCLOSURE.test(draftMessage)) {
    v.push({ code: 'reveals_budget', detail: 'message discloses a budget or price ceiling' });
  }
  if (proposesOffPlatform(draftMessage)) {
    v.push({
      code: 'agrees_off_platform',
      detail: 'message proposes or accepts an off-platform payment/contact method',
    });
  }
  return v;
}
