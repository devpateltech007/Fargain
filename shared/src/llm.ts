import { z } from 'zod';

// LLM output contracts. Every model response is parsed with these schemas; the backend retries
// once on invalid JSON / schema mismatch and then fails closed.

export const RiskFlagCode = z.enum([
  'off_platform_payment', // seller asks for Zelle/wire/gift cards/crypto/"friends and family" etc.
  'suspicious_seller', // new account, inconsistent story, refuses inspection, etc.
  'price_too_good', // price far below fair value
  'pressure_tactics', // artificial urgency, threats
  'max_price_probe', // seller tries to get the buyer's budget
  'shipping_or_overpayment_scam', // overpayment, fake shipping agent, prepaid label tricks
  'personal_info_request', // asks for codes, passwords, IDs, phone verification codes
  'other',
]);
export type RiskFlagCode = z.infer<typeof RiskFlagCode>;

export const RiskFlag = z.object({
  code: RiskFlagCode,
  detail: z.string().min(1),
});
export type RiskFlag = z.infer<typeof RiskFlag>;

const Confidence = z.number().min(0).max(1);
const Money = z.number().finite().nonnegative();

export const PriceAssessment = z.object({
  fair_price_estimate: Money,
  confidence: Confidence,
  suggested_opening_offer: Money,
  reasoning: z.string().min(1),
  risk_flags: z.array(RiskFlag),
});
export type PriceAssessment = z.infer<typeof PriceAssessment>;

export const Tone = z.enum(['friendly', 'neutral', 'firm']);
export type Tone = z.infer<typeof Tone>;

export const NegotiationDraft = z.object({
  draft_message: z.string().min(1),
  proposed_offer: Money.nullable(),
  tone: Tone,
  reasoning: z.string().min(1),
  risk_flags: z.array(RiskFlag),
  /** Present when the agent cannot proceed without the user (e.g. seller asked a question only the user can answer). */
  needs_user_input: z.string().min(1).optional(),
});
export type NegotiationDraft = z.infer<typeof NegotiationDraft>;

export const AgreedPriceExtraction = z
  .object({
    agreed: z.boolean(),
    price: Money.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    evidence_quote: z.string(),
  })
  .refine((v) => !v.agreed || v.price !== undefined, {
    message: 'price is required when agreed is true',
    path: ['price'],
  });
export type AgreedPriceExtraction = z.infer<typeof AgreedPriceExtraction>;

export const ProductCandidate = z.object({
  label: z.string().min(1),
  brand: z.string().min(1).optional(),
  category: z.string().min(1),
  search_query: z.string().min(1),
  confidence: Confidence,
});
export type ProductCandidate = z.infer<typeof ProductCandidate>;

export const ProductIdentification = z.object({
  candidates: z.array(ProductCandidate),
  needs_confirmation: z.boolean(),
});
export type ProductIdentification = z.infer<typeof ProductIdentification>;

/** JSON Schemas for passing to the LLM provider (structured output / tool input schema). */
export const llmJsonSchemas = {
  PriceAssessment: z.toJSONSchema(PriceAssessment),
  NegotiationDraft: z.toJSONSchema(NegotiationDraft),
  AgreedPriceExtraction: z.toJSONSchema(AgreedPriceExtraction),
  ProductIdentification: z.toJSONSchema(ProductIdentification),
} as const;
