import { describe, expect, it } from 'vitest';
import {
  centsToValue,
  evaluatePaymentRequest,
  exceedsMaxPrice,
  type PaymentPolicyInput,
} from './policy.js';

const base: PaymentPolicyInput = {
  amount: 85,
  currency: 'USD',
  expectedCurrency: 'USD',
  maxPrice: 100,
  agreedPrice: 85,
  negotiationStatus: 'agreed',
};

const code = (over: Partial<PaymentPolicyInput>) => {
  const r = evaluatePaymentRequest({ ...base, ...over });
  return r.ok ? 'ok' : r.code;
};

describe('evaluatePaymentRequest', () => {
  it('allows the confirmed price when it is within the cap', () => {
    expect(evaluatePaymentRequest(base)).toEqual({ ok: true, amountCents: 8500 });
  });

  it('allows a payment exactly at max_price', () => {
    expect(code({ amount: 100, agreedPrice: 100 })).toBe('ok');
  });

  it('rejects one cent above max_price', () => {
    expect(code({ amount: 100.01, agreedPrice: 100.01 })).toBe('exceeds_max_price');
  });

  it('rejects above max_price even if the agreed price matches the amount', () => {
    expect(code({ amount: 150, agreedPrice: 150 })).toBe('exceeds_max_price');
  });

  it('checks the cap before the amount/agreed match, so over-cap requests are always reported as such', () => {
    expect(code({ amount: 120, agreedPrice: 85 })).toBe('exceeds_max_price');
  });

  it('is not fooled by floating point (0.1 + 0.2 vs 0.3)', () => {
    expect(code({ amount: 0.1 + 0.2, agreedPrice: 0.3, maxPrice: 0.3 })).toBe('ok');
  });

  it('rejects when no max_price is set', () => {
    expect(code({ maxPrice: null })).toBe('no_max_price');
  });

  it('rejects when the user has not confirmed a price', () => {
    expect(code({ negotiationStatus: 'open', agreedPrice: null })).toBe('negotiation_not_agreed');
    expect(code({ negotiationStatus: 'agreed', agreedPrice: null })).toBe('negotiation_not_agreed');
    expect(code({ negotiationStatus: 'abandoned' })).toBe('negotiation_not_agreed');
  });

  it('rejects already-paid negotiations', () => {
    expect(code({ negotiationStatus: 'paid' })).toBe('already_paid');
  });

  it('rejects an amount different from the confirmed price (below the cap)', () => {
    expect(code({ amount: 90 })).toBe('amount_mismatch');
  });

  it('rejects other currencies', () => {
    expect(code({ currency: 'EUR' })).toBe('currency_mismatch');
  });

  it('rejects zero, negative and non-finite amounts', () => {
    expect(code({ amount: 0 })).toBe('amount_mismatch');
    expect(code({ amount: -5 })).toBe('amount_mismatch');
    expect(code({ amount: Number.NaN })).toBe('amount_mismatch');
    expect(code({ amount: Number.POSITIVE_INFINITY })).toBe('amount_mismatch');
  });
});

describe('helpers', () => {
  it('exceedsMaxPrice compares in cents and treats null as uncapped', () => {
    expect(exceedsMaxPrice(100.01, 100)).toBe(true);
    expect(exceedsMaxPrice(100, 100)).toBe(false);
    expect(exceedsMaxPrice(1e6, null)).toBe(false);
  });

  it('centsToValue formats PayPal amount strings', () => {
    expect(centsToValue(8500)).toBe('85.00');
    expect(centsToValue(1)).toBe('0.01');
    expect(centsToValue(123456)).toBe('1234.56');
  });
});
