import { afterEach, describe, expect, it } from 'vitest';
import { fakeLlm, startTestApp } from '../test-utils.js';
import { LlmError, generateStructured } from '../llm/provider.js';
import { NegotiationDraft, llmJsonSchemas } from '@fargain/shared';

// A distinctive max price so we can search prompts for any rendering of it.
const MAX = 157.35;
const MAX_RENDERINGS = ['157.35', '157.3', '157,35', '15735'];

const assessment = {
  fair_price_estimate: 150,
  confidence: 0.7,
  suggested_opening_offer: 125,
  reasoning: 'Used XM5s in like-new condition sell for 140-160.',
  risk_flags: [],
};
const draft = (over: Partial<Record<string, unknown>> = {}) => ({
  draft_message: 'Hi! Would you take $130? I can pick up today.',
  proposed_offer: 130,
  tone: 'friendly',
  reasoning: 'Opening below fair price.',
  risk_flags: [],
  ...over,
});

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(script: Parameters<typeof fakeLlm>[0]) {
  const llm = fakeLlm(script);
  const t = await startTestApp({ llm: llm.provider });
  close = t.close;
  const item = await t.json('POST', '/api/wishlist', {
    title: 'Sony WH-1000XM5',
    target_price: 130,
    max_price: MAX,
  });
  const neg = await t.json('POST', '/api/negotiations', {
    item_id: item.body.id,
    platform: 'mock_seller',
    listing_url: 'http://localhost:3000/mock-seller/?run=test',
    listing: {
      title: 'Sony WH-1000XM5 headphones',
      price: 180,
      currency: 'USD',
      description: 'Like new.',
    },
  });
  expect(neg.status).toBe(201);
  const audits = (action: string) =>
    t.db
      .prepare('SELECT detail_json FROM audit_log WHERE action = ?')
      .all(action)
      .map((r) => JSON.parse((r as { detail_json: string }).detail_json));
  return { t, llm, negId: neg.body.id as number, audits };
}

describe('negotiation guardrails (end to end through the API)', () => {
  it('never sends the max price to the LLM', async () => {
    const { t, llm, negId } = await setup({
      assess: [assessment],
      draft: [draft(), draft()],
      agree: [{ agreed: false, evidence_quote: '' }],
    });
    await t.json('POST', `/api/negotiations/${negId}/draft`, {});
    await t.json('POST', `/api/negotiations/${negId}/seller-message`, {
      text: "What's your max budget?",
    });
    await t.json('POST', `/api/negotiations/${negId}/draft`, { instructions: 'be friendly' });
    expect(llm.calls.length).toBeGreaterThanOrEqual(4);
    const prompts = llm.promptText();
    for (const r of MAX_RENDERINGS) expect(prompts).not.toContain(r);
    // Sanity: the prompt does include the listing price and target.
    expect(prompts).toContain('180.00');
    expect(prompts).toContain('130.00');
  });

  it('returns a clean draft, flags, and an assessment', async () => {
    const { t, negId, audits } = await setup({ assess: [assessment], draft: [draft()] });
    const r = await t.json('POST', `/api/negotiations/${negId}/draft`, {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      blocked: false,
      violations: [],
      draft: { proposed_offer: 130 },
      assessment: { fair_price_estimate: 150 },
    });
    expect(r.body.message.role).toBe('buyer_draft');
    expect(audits('agent.draft_created')).toHaveLength(1);
    expect(audits('agent.price_assessed')).toHaveLength(1);
  });

  it('never exceeds max: an over-max offer is retried, then blocked with a user prompt', async () => {
    const { t, llm, negId, audits } = await setup({
      assess: [assessment],
      draft: [
        draft({ draft_message: 'Ok, $175 works.', proposed_offer: 175 }),
        draft({ draft_message: 'How about $170?', proposed_offer: 170 }),
      ],
    });
    const r = await t.json('POST', `/api/negotiations/${negId}/draft`, {});
    expect(r.body.blocked).toBe(true);
    expect(r.body.violations.map((v: { code: string }) => v.code)).toContain('offer_above_max');
    expect(r.body.draft.needs_user_input).toMatch(/max price/i);
    // The retry feedback told the model to go lower, without revealing the number.
    const retry = JSON.stringify(llm.calls.at(-1));
    expect(retry).toMatch(/too high/);
    for (const s of MAX_RENDERINGS) expect(retry).not.toContain(s);
    expect(audits('agent.draft_blocked')).toHaveLength(1);
  });

  it('never reveals max: a budget-disclosing draft is retried and replaced', async () => {
    const { t, negId } = await setup({
      assess: [assessment],
      draft: [
        draft({ draft_message: 'My budget is 150, can you do 140?', proposed_offer: 140 }),
        draft({ draft_message: 'Could you do $140?', proposed_offer: 140 }),
      ],
    });
    const r = await t.json('POST', `/api/negotiations/${negId}/draft`, {});
    expect(r.body.blocked).toBe(false);
    expect(r.body.draft.draft_message).toBe('Could you do $140?');
  });

  it('server rejects a user-approved message that exceeds max or reveals the budget', async () => {
    const { t, negId, audits } = await setup({});
    const over = await t.json('POST', `/api/negotiations/${negId}/buyer-message`, {
      text: 'Fine, $165 it is.',
    });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('unsafe_message');
    const reveal = await t.json('POST', `/api/negotiations/${negId}/buyer-message`, {
      text: 'My max is 150.',
    });
    expect(reveal.status).toBe(422);
    const ok = await t.json('POST', `/api/negotiations/${negId}/buyer-message`, {
      text: 'Would you do $140?',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.message.role).toBe('buyer_sent');
    expect(audits('negotiation.buyer_message_rejected')).toHaveLength(2);
  });

  it('flags off-platform payment deterministically, even when the LLM reports nothing', async () => {
    const { t, negId } = await setup({
      assess: [assessment],
      agree: [{ agreed: false, evidence_quote: '' }],
      draft: [
        draft({
          draft_message: "I'd rather not use Zelle. Can we do PayPal Goods & Services? $140?",
          proposed_offer: 140,
        }),
      ],
    });
    const s = await t.json('POST', `/api/negotiations/${negId}/seller-message`, {
      text: 'Can you pay with Zelle? Text me 555-201-3344',
    });
    expect(s.status).toBe(201);
    expect(s.body.risk_flags.map((f: { code: string }) => f.code)).toContain(
      'off_platform_payment',
    );
    const d = await t.json('POST', `/api/negotiations/${negId}/draft`, {});
    expect(d.body.blocked).toBe(false);
    expect(d.body.risk_flags.map((f: { code: string }) => f.code)).toContain(
      'off_platform_payment',
    );
  });

  it('detects agreement as a suggestion only, and marks above-max agreements', async () => {
    const { t, negId } = await setup({
      agree: [{ agreed: true, price: 170, currency: 'USD', evidence_quote: 'ok 170 deal' }],
    });
    const s = await t.json('POST', `/api/negotiations/${negId}/seller-message`, {
      text: 'ok 170 deal',
    });
    expect(s.body.agreement).toMatchObject({ agreed: true, price: 170, exceeds_max_price: true });
    // Nothing changes until the user confirms, and confirming above max is refused.
    expect((await t.json('GET', `/api/negotiations/${negId}`)).body.status).toBe('open');
    expect(
      (await t.json('POST', `/api/negotiations/${negId}/confirm-price`, { agreed_price: 170 }))
        .status,
    ).toBe(422);
  });

  it('works without an LLM for seller messages, and returns 503 for drafts', async () => {
    const t = await startTestApp();
    close = t.close;
    const item = await t.json('POST', '/api/wishlist', { title: 'x', max_price: 100 });
    const neg = await t.json('POST', '/api/negotiations', {
      item_id: item.body.id,
      platform: 'mock_seller',
    });
    const s = await t.json('POST', `/api/negotiations/${neg.body.id}/seller-message`, {
      text: 'Zelle only',
    });
    expect(s.status).toBe(201);
    expect(s.body.agreement).toBeNull();
    const d = await t.json('POST', `/api/negotiations/${neg.body.id}/draft`, {});
    expect(d.status).toBe(503);
    expect(d.body.error.code).toBe('not_configured');
  });

  it('finds negotiations by listing URL and returns messages', async () => {
    const { t, negId } = await setup({});
    await t.json('POST', `/api/negotiations/${negId}/buyer-message`, {
      text: 'Hi, is this available?',
    });
    const list = await t.json(
      'GET',
      `/api/negotiations?listing_url=${encodeURIComponent('http://localhost:3000/mock-seller/?run=test')}`,
    );
    expect(list.body.negotiations.map((n: { id: number }) => n.id)).toEqual([negId]);
    const v = await t.json('GET', `/api/negotiations/${negId}`);
    expect(v.body.messages).toHaveLength(1);
    expect(v.body.listing.price).toBe(180);
  });
});

describe('generateStructured', () => {
  it('retries once on invalid JSON, then succeeds', async () => {
    const llm = fakeLlm({ raw: ['not json', JSON.stringify(draft())] });
    const r = await generateStructured(llm.provider, NegotiationDraft, {
      purpose: 'text',
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      jsonSchema: llmJsonSchemas.NegotiationDraft,
    });
    expect(r.attempts).toBe(2);
    expect(JSON.stringify(llm.calls[1]!.messages)).toContain('previous output was invalid');
    // The retry ends with a user turn (no assistant prefill, which JSON outputs reject).
    expect(llm.calls[1]!.messages.at(-1)!.role).toBe('user');
  });

  it('fails closed after two invalid outputs', async () => {
    const llm = fakeLlm({ raw: ['{"draft_message": 5}', 'nope'] });
    await expect(
      generateStructured(llm.provider, NegotiationDraft, {
        purpose: 'text',
        system: 's',
        messages: [{ role: 'user', content: 'x' }],
        jsonSchema: llmJsonSchemas.NegotiationDraft,
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
