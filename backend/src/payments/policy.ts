import { toCents, type NegotiationStatus, type PaymentRejectionCode } from '@fargain/shared';

/**
 * Server-side payment policy. This is the ONLY place that decides whether a payment may be
 * created. It is deliberately a pure function over values read from the database, so the
 * LLM, the extension, and request bodies cannot influence the cap except through `amount`,
 * which is checked against it.
 *
 * All comparisons are in integer cents.
 */
export interface PaymentPolicyInput {
  /** Amount requested by the client. */
  amount: number;
  /** Currency requested by the client (defaults to the configured currency). */
  currency: string;
  /** Configured PayPal currency. Only this currency is allowed. */
  expectedCurrency: string;
  /** wishlist_items.max_price from the DB. null = no cap set = payments not allowed. */
  maxPrice: number | null;
  /** negotiations.agreed_price from the DB (set only by the user via confirm-price). */
  agreedPrice: number | null;
  negotiationStatus: NegotiationStatus;
}

export type PaymentPolicyResult =
  { ok: true; amountCents: number } | { ok: false; code: PaymentRejectionCode; message: string };

export function evaluatePaymentRequest(input: PaymentPolicyInput): PaymentPolicyResult {
  const amountCents = toCents(input.amount);

  if (!Number.isFinite(input.amount) || amountCents <= 0) {
    // Defensive: the HTTP layer already rejects these.
    return { ok: false, code: 'amount_mismatch', message: 'amount must be a positive number' };
  }
  if (input.negotiationStatus === 'paid') {
    return { ok: false, code: 'already_paid', message: 'this negotiation has already been paid' };
  }
  if (input.negotiationStatus !== 'agreed' || input.agreedPrice === null) {
    return {
      ok: false,
      code: 'negotiation_not_agreed',
      message: 'the user must confirm the agreed price before a payment can be created',
    };
  }
  if (input.currency !== input.expectedCurrency) {
    return {
      ok: false,
      code: 'currency_mismatch',
      message: `only ${input.expectedCurrency} payments are supported`,
    };
  }
  if (input.maxPrice === null) {
    return {
      ok: false,
      code: 'no_max_price',
      message: 'set a max price on the wishlist item before paying',
    };
  }
  if (amountCents > toCents(input.maxPrice)) {
    return {
      ok: false,
      code: 'exceeds_max_price',
      message: 'requested amount is above the max price for this item',
    };
  }
  if (amountCents !== toCents(input.agreedPrice)) {
    return {
      ok: false,
      code: 'amount_mismatch',
      message: 'amount must equal the price the user confirmed',
    };
  }
  return { ok: true, amountCents };
}

/** Same cap check, used when the user confirms an agreed price. */
export function exceedsMaxPrice(amount: number, maxPrice: number | null): boolean {
  return maxPrice !== null && toCents(amount) > toCents(maxPrice);
}

export function centsToValue(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
