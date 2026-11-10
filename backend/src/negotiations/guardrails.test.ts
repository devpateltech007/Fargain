import { describe, expect, it } from 'vitest';
import { checkBuyerMessage, detectSellerRisks, extractAmounts, mergeFlags } from './guardrails.js';

const codes = (text: string) => detectSellerRisks(text).map((f) => f.code);
const violations = (
  draftMessage: string,
  proposedOffer: number | null = null,
  maxPrice: number | null = 160,
) => checkBuyerMessage({ draftMessage, proposedOffer, maxPrice }).map((v) => v.code);

describe('extractAmounts', () => {
  it('finds explicit and bare price amounts', () => {
    expect(extractAmounts('Would you take $140?')).toEqual([140]);
    expect(extractAmounts('I can do 145 dollars')).toEqual([145]);
    expect(extractAmounts('how about 150')).toEqual([150]);
    expect(extractAmounts('$1,200.50 is too much')).toEqual([1200.5]);
    expect(extractAmounts('USD 99')).toEqual([99]);
  });

  it('ignores model numbers, years, times and small counts', () => {
    expect(extractAmounts('Is the WH-1000XM5 the 2023 model?')).toEqual([]);
    expect(extractAmounts('I can pick up at 5:30 in 2 days')).toEqual([]);
    expect(extractAmounts('iPhone 15 Pro')).toEqual([15]);
  });
});

describe('checkBuyerMessage: never exceeds max price', () => {
  it('blocks a proposed offer above max_price', () => {
    expect(violations('Would you do $170?', 170)).toContain('offer_above_max');
  });

  it('blocks any amount above max_price in the text, even when proposed_offer is fine', () => {
    expect(violations('I could maybe stretch to 175 later, but $140 for now?', 140)).toEqual([
      'amount_above_max',
    ]);
  });

  it('allows offers at or below max and compares in cents', () => {
    expect(violations('Could you do $160?', 160)).toEqual([]);
    expect(violations('Could you do $160.01?', 160.01)).toEqual(
      expect.arrayContaining(['offer_above_max', 'amount_above_max']),
    );
  });

  it('does not treat model numbers as amounts', () => {
    expect(violations('Does the WH-1000XM5 come with the case? Would you take $140?', 140)).toEqual(
      [],
    );
  });
});

describe('checkBuyerMessage: never reveals the budget', () => {
  it.each([
    'My budget is 150.',
    'My max is $150, can you meet me there?',
    'The most I can pay is 150.',
    "I can't go above 150.",
    'Max I can do is 150',
    "I'm willing to go up to $150",
  ])('blocks %j', (msg) => {
    expect(violations(msg, 150)).toContain('reveals_budget');
  });

  it('allows normal haggling language', () => {
    expect(violations('Would you take $140? I can pick up today.', 140)).toEqual([]);
    expect(violations("That's a bit high for me. How about $145?", 145)).toEqual([]);
  });
});

describe('checkBuyerMessage: off-platform payment', () => {
  it('blocks proposing or accepting off-platform payment', () => {
    expect(violations('Sure, I can Zelle you $140.', 140)).toContain('agrees_off_platform');
    expect(violations("Ok I'll text me at your number", null)).toContain('agrees_off_platform');
  });

  it('allows declining off-platform payment', () => {
    expect(
      violations("I'd rather not use Zelle. Can we do PayPal Goods & Services instead?", null),
    ).toEqual([]);
    expect(violations('Sorry, I only pay through PayPal, not Cash App.', null)).toEqual([]);
  });
});

describe('detectSellerRisks', () => {
  it('flags off-platform payment requests', () => {
    expect(codes('Can you pay with Zelle? Faster for me')).toContain('off_platform_payment');
    expect(codes('Send it PayPal friends and family please')).toContain('off_platform_payment');
    expect(codes('I only take gift cards')).toContain('off_platform_payment');
    expect(codes('Text me at 555-201-3344')).toContain('off_platform_payment');
    expect(codes('email me at jordan@example.com')).toContain('off_platform_payment');
  });

  it('flags scams and budget probes', () => {
    expect(codes('I need a deposit to hold them')).toContain('pressure_tactics');
    expect(codes('Send me the verification code you get')).toContain('personal_info_request');
    expect(codes("What's your budget?")).toContain('max_price_probe');
    expect(codes('I will overpay and you refund the difference')).toContain(
      'shipping_or_overpayment_scam',
    );
  });

  it('does not flag a normal message', () => {
    expect(codes('Yes still available, asking $180. Pickup in Brooklyn.')).toEqual([]);
    expect(codes('Ok, deal at $145. PayPal is fine.')).toEqual([]);
  });

  it('mergeFlags de-duplicates', () => {
    const f = { code: 'other' as const, detail: 'x' };
    expect(mergeFlags([f], [f, { code: 'other', detail: 'y' }])).toHaveLength(2);
  });
});
