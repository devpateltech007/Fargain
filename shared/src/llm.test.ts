import { describe, expect, it } from 'vitest';
import {
  AgreedPriceExtraction,
  NegotiationDraft,
  PriceAssessment,
  ProductIdentification,
  llmJsonSchemas,
} from './llm.js';
import { Price, UserProfile, toCents } from './domain.js';

describe('LLM contracts', () => {
  it('accepts a valid PriceAssessment', () => {
    const r = PriceAssessment.safeParse({
      fair_price_estimate: 120,
      confidence: 0.7,
      suggested_opening_offer: 95,
      reasoning: 'Comparable listings sell for 110-130.',
      risk_flags: [],
    });
    expect(r.success).toBe(true);
  });

  it('rejects confidence outside 0..1 and unknown risk codes', () => {
    expect(
      PriceAssessment.safeParse({
        fair_price_estimate: 120,
        confidence: 7,
        suggested_opening_offer: 95,
        reasoning: 'x',
        risk_flags: [],
      }).success,
    ).toBe(false);
    expect(
      NegotiationDraft.safeParse({
        draft_message: 'Hi',
        proposed_offer: 90,
        tone: 'friendly',
        reasoning: 'x',
        risk_flags: [{ code: 'made_up', detail: 'x' }],
      }).success,
    ).toBe(false);
  });

  it('requires a price when agreed is true', () => {
    expect(
      AgreedPriceExtraction.safeParse({ agreed: true, evidence_quote: 'ok deal' }).success,
    ).toBe(false);
    expect(
      AgreedPriceExtraction.safeParse({
        agreed: true,
        price: 80,
        currency: 'USD',
        evidence_quote: '80 works',
      }).success,
    ).toBe(true);
    expect(AgreedPriceExtraction.safeParse({ agreed: false, evidence_quote: '' }).success).toBe(
      true,
    );
  });

  it('validates ProductIdentification candidates', () => {
    expect(
      ProductIdentification.safeParse({
        candidates: [
          {
            label: 'Air Force 1',
            brand: 'Nike',
            category: 'shoes',
            search_query: 'Nike Air Force 1 07',
            confidence: 0.8,
          },
        ],
        needs_confirmation: false,
      }).success,
    ).toBe(true);
    expect(
      ProductIdentification.safeParse({ candidates: [{ label: '' }], needs_confirmation: true })
        .success,
    ).toBe(false);
  });

  it('exports JSON schemas for every contract', () => {
    for (const schema of Object.values(llmJsonSchemas)) {
      expect(schema).toHaveProperty('type', 'object');
    }
  });
});

describe('domain', () => {
  it('Price accepts at most two decimals', () => {
    expect(Price.safeParse(19.99).success).toBe(true);
    expect(Price.safeParse(19.999).success).toBe(false);
    expect(Price.safeParse(-1).success).toBe(false);
  });

  it('toCents avoids float drift', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
  });

  it('UserProfile applies defaults and validates birthday', () => {
    expect(UserProfile.parse({})).toEqual({ student: false, memberships: [] });
    expect(UserProfile.safeParse({ birthday: '03/04/2000' }).success).toBe(false);
  });
});
