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

// Anthropic docs warn that fields asking for step-by-step thinking can trigger a refusal, so
// `reasoning` is described as a short explanation shown to the user.
const Explanation = z
  .string()
  .min(1)
  .describe('Short explanation for the buyer (1-3 sentences). Not step-by-step thinking.');

export const PriceAssessment = z.object({
  fair_price_estimate: Money,
  confidence: Confidence,
  suggested_opening_offer: Money,
  reasoning: Explanation,
  risk_flags: z.array(RiskFlag),
});
export type PriceAssessment = z.infer<typeof PriceAssessment>;

export const Tone = z.enum(['friendly', 'neutral', 'firm']);
export type Tone = z.infer<typeof Tone>;

export const NegotiationDraft = z.object({
  draft_message: z.string().min(1),
  proposed_offer: Money.nullable(),
  tone: Tone,
  reasoning: Explanation,
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

type JsonSchema = { [key: string]: unknown };

/**
 * Keywords Anthropic structured outputs reject with HTTP 400 (verified against
 * platform.claude.com/docs/en/build-with-claude/structured-outputs, "JSON Schema limitations").
 * They are moved into `description` so the model still sees them; zod enforces them on the response.
 */
const UNSUPPORTED = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'maxItems',
] as const;

/** Convert a JSON Schema into the subset accepted by Anthropic structured outputs. */
export function toStructuredOutputSchema(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: JsonSchema = {};
    const moved: string[] = [];
    for (const [k, v] of Object.entries(node as JsonSchema)) {
      if (k === '$schema') continue;
      if ((UNSUPPORTED as readonly string[]).includes(k)) {
        moved.push(`${k}: ${JSON.stringify(v)}`);
        continue;
      }
      if (k === 'minItems' && typeof v === 'number' && v > 1) {
        moved.push(`minItems: ${v}`);
        out.minItems = 1;
        continue;
      }
      out[k] = walk(v);
    }
    if (moved.length) {
      const d = typeof out.description === 'string' ? `${out.description} ` : '';
      out.description = `${d}{${moved.join(', ')}}`;
    }
    if (out.type === 'object') out.additionalProperties = false;
    return out;
  };
  return walk(schema) as JsonSchema;
}

/** JSON Schemas for passing to the LLM provider (structured output). */
export const llmJsonSchemas = {
  PriceAssessment: toStructuredOutputSchema(z.toJSONSchema(PriceAssessment) as JsonSchema),
  NegotiationDraft: toStructuredOutputSchema(z.toJSONSchema(NegotiationDraft) as JsonSchema),
  AgreedPriceExtraction: toStructuredOutputSchema(
    z.toJSONSchema(AgreedPriceExtraction) as JsonSchema,
  ),
  ProductIdentification: toStructuredOutputSchema(
    z.toJSONSchema(ProductIdentification) as JsonSchema,
  ),
} as const;
