import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeLlm, startTestApp } from '../test-utils.js';
import type { Channel3Api } from '../pricing/channel3.js';
import { XM5_RESULTS } from '../pricing/fixtures.js';
import { clampToBytes, type Messenger } from './messenger.js';
import {
  canonicalInstagramUrl,
  findInstagramUrl,
  findLinkCode,
  parseChoice,
  parseInstagramWebhook,
  verifyMetaSignature,
} from './parse.js';

const SECRET = 'app-secret-for-tests';
const VERIFY = 'verify-token-for-tests';
const IG_ENV = { IG_APP_SECRET: SECRET, IG_VERIFY_TOKEN: VERIFY };

/** Webhook body shaped like Meta's documented Instagram messaging payload. */
const dmBody = (mid: string, message: Record<string, unknown>, sender = 'IGSID-123') => ({
  object: 'instagram',
  entry: [
    {
      id: 'IGID-FARGAIN',
      time: 1,
      messaging: [
        {
          sender: { id: sender },
          recipient: { id: 'IGID-FARGAIN' },
          timestamp: 1,
          message: { mid, ...message },
        },
      ],
    },
  ],
});

describe('Instagram webhook parsing (link parsing + payload shapes)', () => {
  it('extracts ig_reel shares with their title, and drops echoes/deleted/self messages', () => {
    const body = {
      object: 'instagram',
      entry: [
        {
          id: 'IGID',
          messaging: [
            {
              sender: { id: 'u1' },
              recipient: { id: 'IGID' },
              message: {
                mid: 'm1',
                attachments: [
                  {
                    type: 'ig_reel',
                    payload: {
                      url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1',
                      title: 'Best headphones 2026 🎧 Sony XM5',
                    },
                  },
                ],
              },
            },
            {
              sender: { id: 'IGID' },
              recipient: { id: 'u1' },
              message: { mid: 'm2', text: 'hi', is_echo: true },
            },
            {
              sender: { id: 'u1' },
              recipient: { id: 'IGID' },
              message: { mid: 'm3', is_deleted: true },
            },
            {
              sender: { id: 'u1' },
              recipient: { id: 'IGID' },
              message: { mid: 'm4', text: 'test', is_self: true },
            },
          ],
        },
      ],
    };
    expect(parseInstagramWebhook(body)).toEqual([
      {
        mid: 'm1',
        senderId: 'u1',
        recipientId: 'IGID',
        text: null,
        share: {
          kind: 'reel',
          url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1',
          caption: 'Best headphones 2026 🎧 Sony XM5',
        },
        imageUrl: null,
      },
    ]);
  });

  it('handles post shares, screenshots, and reel links pasted as text', () => {
    const [post] = parseInstagramWebhook(
      dmBody('a', {
        attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.example/p.jpg' } }],
      }),
    );
    expect(post!.share).toEqual({ kind: 'post', url: 'https://cdn.example/p.jpg', caption: null });
    const [shot] = parseInstagramWebhook(
      dmBody('b', {
        attachments: [{ type: 'image', payload: { url: 'https://cdn.example/s.png' } }],
      }),
    );
    expect(shot!).toMatchObject({ share: null, imageUrl: 'https://cdn.example/s.png' });
    const [link] = parseInstagramWebhook(
      dmBody('c', { text: 'look https://www.instagram.com/reel/C9xYz_12-a/?igsh=abc123 !!' }),
    );
    expect(link!.share).toEqual({
      kind: 'link',
      url: 'https://www.instagram.com/reel/C9xYz_12-a/',
      caption: null,
    });
  });

  it('ignores non-instagram objects and malformed bodies', () => {
    expect(parseInstagramWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseInstagramWebhook({ nope: true })).toEqual([]);
    expect(parseInstagramWebhook('x')).toEqual([]);
  });

  it('finds and canonicalizes instagram links', () => {
    expect(findInstagramUrl('https://instagram.com/p/AbC123/')).toBe(
      'https://instagram.com/p/AbC123/',
    );
    expect(findInstagramUrl('https://www.instagram.com/share/reel/BAJpnWjdDV')).toBe(
      'https://www.instagram.com/share/reel/BAJpnWjdDV',
    );
    expect(findInstagramUrl('https://www.tiktok.com/@x/video/1')).toBeNull();
    expect(findInstagramUrl('https://www.instagram.com/someuser/')).toBeNull();
    expect(canonicalInstagramUrl('https://www.instagram.com/reel/X1/?igsh=1&utm_source=ig#t')).toBe(
      'https://www.instagram.com/reel/X1/',
    );
  });

  it('parses link codes and numbered choices', () => {
    expect(findLinkCode('my code is fg-a2b3c4 thanks')).toBe('FG-A2B3C4');
    expect(findLinkCode('FG-A0B1C2')).toBeNull(); // 0 and 1 are not in the alphabet
    expect(parseChoice('2', 3)).toBe(2);
    expect(parseChoice('#3', 3)).toBe(3);
    expect(parseChoice('option 1', 3)).toBe(1);
    expect(parseChoice('4', 3)).toBeNull();
    expect(parseChoice('the second one', 3)).toBeNull();
  });

  it('verifies X-Hub-Signature-256 over the raw body', () => {
    const raw = Buffer.from('{"object":"instagram"}');
    const sig = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
    expect(verifyMetaSignature(raw, sig, SECRET)).toBe(true);
    expect(verifyMetaSignature(Buffer.from('{"object":"instagram" }'), sig, SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, 'sha256=00', SECRET)).toBe(false);
    expect(verifyMetaSignature(raw, undefined, SECRET)).toBe(false);
  });

  it('clamps replies to 1000 bytes without breaking UTF-8', () => {
    const out = clampToBytes('é'.repeat(800));
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(1000);
    expect(out.endsWith('…')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

const xm5 = {
  label: 'Sony WH-1000XM5 headphones',
  brand: 'Sony',
  category: 'headphones',
  search_query: 'Sony WH-1000XM5',
  confidence: 0.92,
};
const xm4 = {
  label: 'Sony WH-1000XM4 headphones',
  brand: 'Sony',
  category: 'headphones',
  search_query: 'Sony WH-1000XM4',
  confidence: 0.45,
};

function fakes(identify: unknown[]) {
  const sent: { to: string; text: string }[] = [];
  const messenger: Messenger = { sendText: async (to, text) => void sent.push({ to, text }) };
  const channel3: Channel3Api = {
    search: async () => structuredClone(XM5_RESULTS),
    getProduct: async () => null,
  };
  return { sent, messenger, channel3, llm: fakeLlm({ identify }) };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(identify: unknown[] = []) {
  const f = fakes(identify);
  const t = await startTestApp({
    env: IG_ENV,
    llm: f.llm.provider,
    channel3: f.channel3,
    messenger: f.messenger,
  });
  close = t.close;
  const post = async (body: unknown, signature?: string) => {
    const raw = JSON.stringify(body);
    const sig = signature ?? `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
    const res = await t.request('/webhooks/instagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: raw,
    });
    // Processing happens after the ack; give it a moment.
    await new Promise((r) => setTimeout(r, 150));
    return res;
  };
  const link = async (sender = 'IGSID-123') => {
    const { body } = await t.json('POST', '/api/link/start', {});
    await post(dmBody(`link-${sender}`, { text: `here: ${body.code}` }, sender));
    return body.code as string;
  };
  return { t, ...f, post, link };
}

describe('Instagram webhook endpoint', () => {
  it('answers the verify handshake only with the right token', async () => {
    const { t } = await setup();
    const ok = await t.request(
      `/webhooks/instagram?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`,
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('1158201444');
    expect(
      (
        await t.request(
          '/webhooks/instagram?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1',
        )
      ).status,
    ).toBe(403);
  });

  it('rejects bad signatures and audits them', async () => {
    const { t, post } = await setup();
    expect((await post(dmBody('x', { text: 'hi' }), 'sha256=deadbeef')).status).toBe(401);
    expect(
      t.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'instagram.webhook_rejected'")
        .get(),
    ).toEqual({ n: 1 });
  });

  it('asks unlinked senders to link, then links with a one-time code', async () => {
    const { t, sent, post, link } = await setup();
    await post(dmBody('m0', { text: 'hello' }));
    expect(sent.at(-1)!.text).toMatch(/Link Instagram/);
    const code = await link();
    expect(sent.at(-1)!.text).toMatch(/^Linked!/);
    expect((await t.json('GET', '/api/link/status')).body).toMatchObject({
      linked: true,
      pending_code: null,
    });
    // The code is single-use.
    await post(dmBody('m-reuse', { text: code }, 'IGSID-OTHER'));
    expect(sent.at(-1)!.text).toMatch(/invalid or expired/);
  });

  it('confident reel share -> Channel3 match -> wishlist item -> DM confirmation; never sends video to the model', async () => {
    const { t, sent, post, link, llm } = await setup([
      { candidates: [xm5], needs_confirmation: false },
    ]);
    await link();
    await post(
      dmBody('r1', {
        attachments: [
          {
            type: 'ig_reel',
            payload: {
              url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=99',
              title: 'my new fav headphones (sony xm5)',
            },
          },
        ],
      }),
    );
    expect(sent.at(-1)!.text).toMatch(
      /^Added "Sony WH-1000XM5 headphones" to your Fargain wishlist\. Best price right now: \$298\.00 at bhphotovideo\.com\. I'll watch for drops to \$253\.00/,
    );
    const items = (await t.json('GET', '/api/wishlist')).body.items;
    expect(items[0]).toMatchObject({
      source: 'instagram',
      target_price: 253,
      title: 'Sony WH-1000XM5 headphones',
    });
    expect(JSON.parse(items[0].channel3_product_ids)).toHaveLength(5);
    // The reel's CDN video URL was never given to the model as an image.
    expect(JSON.stringify(llm.calls)).not.toContain('"image_url"');
    expect(llm.calls[0]!.purpose).toBe('text');
  });

  it('unsure -> numbered options -> user replies "2" -> added; duplicate deliveries are ignored', async () => {
    const { t, sent, post, link } = await setup([
      { candidates: [xm4, { ...xm5, confidence: 0.4 }], needs_confirmation: true },
    ]);
    await link();
    const share = dmBody('r2', {
      attachments: [
        { type: 'ig_reel', payload: { url: 'https://cdn/x', title: 'headphones haul' } },
      ],
    });
    await post(share);
    expect(sent.at(-1)!.text).toBe(
      'Which one is it? Reply with a number:\n1. Sony WH-1000XM4 headphones\n2. Sony WH-1000XM5 headphones\nOr send a screenshot of the product.',
    );
    await post(share); // Meta retry with the same mid
    expect(sent.filter((s) => s.text.startsWith('Which one'))).toHaveLength(1);
    await post(dmBody('r3', { text: '2' }));
    expect(sent.at(-1)!.text).toMatch(/^Added "Sony WH-1000XM5 headphones"/);
    expect((await t.json('GET', '/api/wishlist')).body.items).toHaveLength(1);
  });

  it('no product in caption -> asks for a screenshot -> screenshot is sent to the vision model', async () => {
    const { sent, post, link, llm } = await setup([
      { candidates: [], needs_confirmation: true },
      { candidates: [xm5], needs_confirmation: false },
    ]);
    await link();
    await post(
      dmBody('s1', {
        attachments: [{ type: 'ig_reel', payload: { url: 'https://cdn/y', title: 'vibes ✨' } }],
      }),
    );
    expect(sent.at(-1)!.text).toMatch(/Send me a screenshot/);
    await post(
      dmBody('s2', {
        attachments: [{ type: 'image', payload: { url: 'https://cdn.example/screenshot.png' } }],
      }),
    );
    expect(llm.calls.at(-1)!.purpose).toBe('vision');
    expect(JSON.stringify(llm.calls.at(-1))).toContain('https://cdn.example/screenshot.png');
    expect(JSON.stringify(llm.calls.at(-1))).toContain('vibes'); // carried over the earlier caption
    expect(sent.at(-1)!.text).toMatch(/^Added/);
  });
});

describe('dashboard paste-a-link fallback (same pipeline)', () => {
  it('identifies from link + caption and confirms a choice', async () => {
    const { t, llm } = await setup([{ candidates: [xm4, xm5], needs_confirmation: true }]);
    const r = await t.json('POST', '/api/reels/identify', {
      url: 'https://www.instagram.com/reel/C9xYz/?igsh=zz',
      caption: 'which sony is this',
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('awaiting_confirmation');
    expect(r.body.identification.candidates).toHaveLength(2);
    expect(JSON.stringify(llm.calls[0])).toContain('https://www.instagram.com/reel/C9xYz/');
    const c = await t.json('POST', `/api/reels/${r.body.session_id}/confirm`, { choice: 2 });
    expect(c.body.added).toMatchObject({ title: 'Sony WH-1000XM5 headphones', target_price: 253 });
    expect(
      (await t.json('POST', `/api/reels/${r.body.session_id}/confirm`, { choice: 1 })).status,
    ).toBe(409);
  });

  it('validates input', async () => {
    const { t } = await setup();
    expect((await t.json('POST', '/api/reels/identify', {})).status).toBe(400);
    expect(
      (await t.json('POST', '/api/reels/identify', { url: 'https://www.tiktok.com/@a/video/1' }))
        .status,
    ).toBe(400);
    expect(
      (await t.json('POST', '/api/link/confirm', { code: 'FG-AAAAAA', ig_sender_id: 'x' })).status,
    ).toBe(400);
  });
});
