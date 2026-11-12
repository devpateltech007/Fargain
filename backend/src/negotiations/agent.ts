import {
  AgreedPriceExtraction,
  ListingInfo,
  NegotiationDraft,
  PriceAssessment,
  llmJsonSchemas,
  type RiskFlag,
} from '@fargain/shared';
import { audit } from '../audit.js';
import type { Db } from '../db/index.js';
import { ApiError } from '../http/errors.js';
import { generateStructured, type LlmProvider } from '../llm/provider.js';
import { exceedsMaxPrice } from '../payments/policy.js';
import {
  NOW_SQL,
  insertMessage,
  listMessages,
  type MessageRow,
  type NegotiationRow,
  type WishlistItemRow,
} from '../store.js';
import {
  buyerHasOffered,
  checkBuyerMessage,
  checkOpeningOffer,
  clampOpeningOffer,
  detectSellerRisks,
  mergeFlags,
  type DraftViolation,
} from './guardrails.js';
import { agreementPrompt, assessmentPrompt, draftPrompt, type PromptMessage } from './prompts.js';

export interface AgentDeps {
  db: Db;
  userId: number;
  currency: string;
  llm: () => LlmProvider;
}

export interface DraftResult {
  message: MessageRow;
  draft: NegotiationDraft;
  /** True when guardrails rejected the model output twice. The text must not be inserted. */
  blocked: boolean;
  violations: DraftViolation[];
  risk_flags: RiskFlag[];
  assessment: PriceAssessment | null;
}

export interface SellerMessageResult {
  message: MessageRow;
  risk_flags: RiskFlag[];
  /** Model's reading of whether a price was agreed. A suggestion only: the user must confirm. */
  agreement: (AgreedPriceExtraction & { exceeds_max_price: boolean }) | null;
  agreement_error?: string;
}

const listingOf = (n: NegotiationRow) => ListingInfo.parse(JSON.parse(n.listing_json || '{}'));
const promptItem = (i: WishlistItemRow) => ({
  title: i.title,
  description: i.description,
  target_price: i.target_price,
});
const promptMessages = (rows: MessageRow[]): PromptMessage[] =>
  rows
    .filter((m) => m.role !== 'buyer_draft')
    .map((m) => ({ role: m.role === 'seller' ? 'seller' : 'buyer', text: m.text }));

/** Safe, non-revealing feedback for a retry. It never includes the max price. */
function feedbackFor(violations: DraftViolation[]): string {
  const parts = new Set<string>();
  for (const v of violations) {
    if (v.code === 'offer_above_max' || v.code === 'amount_above_max')
      parts.add(
        'The price you offered or mentioned is too high for this buyer. Offer a lower amount, or set needs_user_input if the seller will not go lower.',
      );
    if (v.code === 'reveals_budget')
      parts.add('Do not mention any budget, maximum, limit, or ceiling.');
    if (v.code === 'agrees_off_platform')
      parts.add(
        'Do not propose or accept payment or contact outside PayPal / the platform; decline it politely.',
      );
    if (v.code === 'opening_too_high') parts.add(v.detail);
  }
  return [...parts].join(' ');
}

export function createNegotiationAgent({ db, userId, currency, llm }: AgentDeps) {
  async function ensureAssessment(
    n: NegotiationRow,
    item: WishlistItemRow,
  ): Promise<PriceAssessment> {
    if (n.assessment_json) return PriceAssessment.parse(JSON.parse(n.assessment_json));
    const listing = listingOf(n);
    const { system, messages } = assessmentPrompt(promptItem(item), listing);
    const { value, model } = await generateStructured(llm(), PriceAssessment, {
      purpose: 'text',
      system,
      messages,
      jsonSchema: llmJsonSchemas.PriceAssessment,
    });
    const opening = clampOpeningOffer(value.suggested_opening_offer, {
      askingPrice: listing.price ?? null,
      targetPrice: item.target_price,
      maxPrice: item.max_price,
    });
    const assessment: PriceAssessment = {
      ...value,
      suggested_opening_offer: Math.round(opening * 100) / 100,
      risk_flags: mergeFlags(detectSellerRisks(listing.description ?? ''), value.risk_flags),
    };
    db.prepare(
      `UPDATE negotiations SET assessment_json = ?, updated_at = ${NOW_SQL} WHERE id = ?`,
    ).run(JSON.stringify(assessment), n.id);
    audit(db, {
      userId,
      actor: 'agent',
      action: 'agent.price_assessed',
      detail: { negotiation_id: n.id, model, ...assessment },
    });
    return assessment;
  }

  async function draft(
    n: NegotiationRow,
    item: WishlistItemRow,
    instructions?: string,
  ): Promise<DraftResult> {
    if (n.status !== 'open')
      throw new ApiError(409, 'negotiation_not_open', `negotiation is ${n.status}`);
    const assessment = await ensureAssessment(n, item);
    const history = listMessages(db, n.id);
    const sellerRisks = mergeFlags(
      ...history.filter((m) => m.role === 'seller').map((m) => detectSellerRisks(m.text)),
    );

    let feedback: string | undefined;
    let result: NegotiationDraft | undefined;
    let violations: DraftViolation[] = [];
    let model = '';
    let attempts = 0;
    for (let round = 1; round <= 2; round++) {
      const { system, messages } = draftPrompt({
        item: promptItem(item),
        listing: listingOf(n),
        assessment,
        messages: promptMessages(history),
        detectedRisks: sellerRisks,
        instructions,
        feedback,
      });
      const out = await generateStructured(llm(), NegotiationDraft, {
        purpose: 'text',
        system,
        messages,
        jsonSchema: llmJsonSchemas.NegotiationDraft,
      });
      result = out.value;
      model = out.model;
      attempts += out.attempts;
      violations = [
        ...checkBuyerMessage({
          draftMessage: result.draft_message,
          proposedOffer: result.proposed_offer,
          maxPrice: item.max_price,
        }),
        ...checkOpeningOffer({
          proposedOffer: result.proposed_offer,
          openingOffer: assessment.suggested_opening_offer,
          buyerHasOffered: buyerHasOffered(history),
        }),
      ];
      if (violations.length === 0) break;
      feedback = feedbackFor(violations);
    }

    const blocked = violations.length > 0;
    const draftOut: NegotiationDraft = {
      ...result!,
      risk_flags: mergeFlags(sellerRisks, result!.risk_flags),
      needs_user_input: blocked
        ? violations.some((v) => v.code === 'offer_above_max' || v.code === 'amount_above_max')
          ? 'The seller seems to want more than your max price. Raise your max, walk away, or write a reply yourself.'
          : 'The agent could not produce a safe draft. Write a reply yourself or regenerate.'
        : result!.needs_user_input,
    };
    const message = insertMessage(db, n.id, 'buyer_draft', draftOut.draft_message, {
      ...draftOut,
      blocked,
      violations,
      model,
      attempts,
      instructions: instructions ?? null,
    });
    audit(db, {
      userId,
      actor: 'agent',
      action: blocked ? 'agent.draft_blocked' : 'agent.draft_created',
      detail: {
        negotiation_id: n.id,
        message_id: message.id,
        proposed_offer: draftOut.proposed_offer,
        tone: draftOut.tone,
        reasoning: draftOut.reasoning,
        risk_flags: draftOut.risk_flags,
        violations,
        model,
      },
    });
    return {
      message,
      draft: draftOut,
      blocked,
      violations,
      risk_flags: draftOut.risk_flags,
      assessment,
    };
  }

  async function recordSellerMessage(
    n: NegotiationRow,
    item: WishlistItemRow,
    text: string,
    llmAvailable: boolean,
  ): Promise<SellerMessageResult> {
    const risk_flags = detectSellerRisks(text);
    const message = insertMessage(db, n.id, 'seller', text, { risk_flags });
    audit(db, {
      userId,
      actor: 'system',
      action: 'negotiation.seller_message',
      detail: { negotiation_id: n.id, message_id: message.id, risk_flags },
    });

    let agreement: SellerMessageResult['agreement'] = null;
    let agreement_error: string | undefined;
    if (llmAvailable && n.status === 'open') {
      try {
        const { system, messages } = agreementPrompt(
          promptMessages(listMessages(db, n.id)),
          currency,
        );
        const { value } = await generateStructured(llm(), AgreedPriceExtraction, {
          purpose: 'text',
          system,
          messages,
          jsonSchema: llmJsonSchemas.AgreedPriceExtraction,
        });
        agreement = {
          ...value,
          exceeds_max_price:
            value.agreed &&
            value.price !== undefined &&
            exceedsMaxPrice(value.price, item.max_price),
        };
        db.prepare('UPDATE messages SET ai_reasoning_json = ? WHERE id = ?').run(
          JSON.stringify({ risk_flags, agreement }),
          message.id,
        );
        if (value.agreed) {
          audit(db, {
            userId,
            actor: 'agent',
            action: 'agent.agreement_detected',
            detail: { negotiation_id: n.id, message_id: message.id, ...agreement },
          });
        }
      } catch (err) {
        // Agreement detection is a convenience; the seller message is already stored.
        agreement_error = err instanceof Error ? err.message : String(err);
        db.prepare('UPDATE messages SET ai_reasoning_json = ? WHERE id = ?').run(
          JSON.stringify({ risk_flags, agreement_error }),
          message.id,
        );
      }
    }
    return { message, risk_flags, agreement, agreement_error };
  }

  /** Server-side re-check before user-approved or autonomous text can go to the page. */
  function recordBuyerMessage(
    n: NegotiationRow,
    item: WishlistItemRow,
    text: string,
    draftMessageId?: number,
    actor: 'user' | 'agent' = 'user',
    validateOnly = false,
  ): MessageRow {
    if (n.status === 'paid' || n.status === 'abandoned')
      throw new ApiError(409, 'negotiation_closed', `negotiation is ${n.status}`);
    if (actor === 'agent') {
      if (n.status !== 'open')
        throw new ApiError(
          409,
          'autopilot_stopped',
          'autopilot can only message an open negotiation',
        );
      if (item.max_price === null)
        throw new ApiError(409, 'autopilot_requires_max', 'set a maximum price before autopilot');
      const history = listMessages(db, n.id);
      const sellerMessages = history.filter((m) => m.role === 'seller');
      const sellerRisk = sellerMessages.flatMap((m) => detectSellerRisks(m.text));
      if (sellerRisk.length > 0)
        throw new ApiError(422, 'seller_risk_review', 'seller risk requires buyer review');
      const latestSeller = [...sellerMessages].at(-1);
      const latestSellerAi = latestSeller?.ai_reasoning_json
        ? (JSON.parse(latestSeller.ai_reasoning_json) as {
            agreement?: { agreed?: boolean };
            agreement_error?: string;
          })
        : null;
      if (latestSellerAi?.agreement_error)
        throw new ApiError(422, 'seller_uncertain', 'seller response requires buyer review');
      if (latestSellerAi?.agreement?.agreed)
        throw new ApiError(409, 'seller_accepted', 'seller agreement requires buyer review');
      const sent = db
        .prepare(
          "SELECT COUNT(*) AS count FROM messages WHERE negotiation_id = ? AND role = 'buyer_sent'",
        )
        .get(n.id) as { count: number };
      if (sent.count >= 3)
        throw new ApiError(409, 'autopilot_message_limit', 'autopilot is limited to 3 messages');
    }
    let draftRow: MessageRow | undefined;
    if (draftMessageId !== undefined) {
      draftRow = db
        .prepare(
          "SELECT * FROM messages WHERE id = ? AND negotiation_id = ? AND role = 'buyer_draft'",
        )
        .get(draftMessageId, n.id) as MessageRow | undefined;
      if (!draftRow) throw new ApiError(404, 'not_found', 'draft message not found');
    }
    let proposedOffer: number | null = null;
    if (actor === 'agent') {
      if (!draftRow || draftRow.text !== text)
        throw new ApiError(422, 'draft_mismatch', 'autopilot can only send its exact saved draft');
      const meta = JSON.parse(draftRow.ai_reasoning_json ?? '{}') as {
        blocked?: boolean;
        needs_user_input?: string | null;
        risk_flags?: RiskFlag[];
        proposed_offer?: number;
      };
      if (meta.blocked || meta.needs_user_input || (meta.risk_flags?.length ?? 0) > 0)
        throw new ApiError(422, 'draft_requires_review', 'this draft requires buyer review');
      proposedOffer = meta.proposed_offer ?? null;
      if (proposedOffer === null || !n.assessment_json)
        throw new ApiError(422, 'draft_invalid', 'autopilot draft is missing a verified offer');
    }
    const violations = checkBuyerMessage({
      draftMessage: text,
      proposedOffer,
      maxPrice: item.max_price,
    });
    if (actor === 'agent' && n.assessment_json && proposedOffer !== null) {
      violations.push(
        ...checkOpeningOffer({
          proposedOffer,
          openingOffer: PriceAssessment.parse(JSON.parse(n.assessment_json))
            .suggested_opening_offer,
          buyerHasOffered: buyerHasOffered(listMessages(db, n.id)),
        }),
      );
    }
    if (violations.length > 0) {
      audit(db, {
        userId,
        actor: 'system',
        action: 'negotiation.buyer_message_rejected',
        detail: { negotiation_id: n.id, violations },
      });
      throw new ApiError(422, 'unsafe_message', 'message failed a safety check', violations);
    }
    if (validateOnly) return draftRow!;
    const message = insertMessage(
      db,
      n.id,
      'buyer_sent',
      text,
      draftRow ? { draft_message_id: draftRow.id, actor } : undefined,
    );
    audit(db, {
      userId,
      actor,
      action: actor === 'agent' ? 'agent.message_sent' : 'negotiation.buyer_message_approved',
      detail: {
        negotiation_id: n.id,
        message_id: message.id,
        draft_message_id: draftRow?.id ?? null,
        edited: draftRow ? draftRow.text !== text : null,
      },
    });
    return message;
  }

  function validateAgentMessage(
    n: NegotiationRow,
    item: WishlistItemRow,
    text: string,
    draftMessageId: number,
  ): void {
    recordBuyerMessage(n, item, text, draftMessageId, 'agent', true);
  }

  return { ensureAssessment, draft, recordSellerMessage, recordBuyerMessage, validateAgentMessage };
}

export type NegotiationAgent = ReturnType<typeof createNegotiationAgent>;

/** For responses: parse stored JSON columns. */
export function serializeNegotiation(n: NegotiationRow) {
  const { listing_json, assessment_json, ...rest } = n;
  return {
    ...rest,
    listing: JSON.parse(listing_json || '{}') as ListingInfo,
    assessment: assessment_json ? (JSON.parse(assessment_json) as PriceAssessment) : null,
  };
}

export function serializeMessage(m: MessageRow) {
  const { ai_reasoning_json, ...rest } = m;
  return {
    ...rest,
    ai: ai_reasoning_json ? (JSON.parse(ai_reasoning_json) as Record<string, unknown>) : null,
  };
}
