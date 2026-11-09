import { afterEach, describe, expect, it } from 'vitest';
import { startTestApp } from '../test-utils.js';
import type { CreateOrderInput, PayPalApi, PayPalOrder } from './paypal-client.js';

/** In-memory PayPal fake that records calls. Used only in tests; the e2e script hits the real sandbox. */
function fakePayPal() {
  const orders = new Map<string, PayPalOrder>();
  const byRequestId = new Map<string, string>();
  const calls = { create: [] as CreateOrderInput[], capture: 0 };
  const api: PayPalApi = {
    async createOrder(i) {
      calls.create.push(i);
      const existing = byRequestId.get(i.requestId);
      if (existing) return orders.get(existing)!;
      const id = `ORDER${orders.size + 1}`;
      const order: PayPalOrder = {
        id,
        status: 'PAYER_ACTION_REQUIRED',
        links: [
          { rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` },
        ],
        purchase_units: [{ amount: { currency_code: i.currency, value: i.amountValue } }],
      };
      orders.set(id, order);
      byRequestId.set(i.requestId, id);
      return order;
    },
    async getOrder(id) {
      return orders.get(id)!;
    },
    async captureOrder(id) {
      calls.capture++;
      const o = orders.get(id)!;
      o.status = 'COMPLETED';
      o.purchase_units![0]!.payments = { captures: [{ id: 'CAP1', status: 'COMPLETED' }] };
      return o;
    },
    async verifyWebhookSignature() {
      return true;
    },
  };
  return { api, orders, calls, approve: (id: string) => (orders.get(id)!.status = 'APPROVED') };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

async function setup(maxPrice: number | null = 100) {
  const pp = fakePayPal();
  const t = await startTestApp({ paypal: pp.api });
  close = t.close;
  const item = await t.json('POST', '/api/wishlist', {
    title: 'Herman Miller Aeron',
    source: 'manual',
    ...(maxPrice === null ? {} : { max_price: maxPrice }),
  });
  const neg = await t.json('POST', '/api/negotiations', {
    item_id: item.body.id,
    platform: 'mock_seller',
  });
  const audits = (action: string) =>
    t.db
      .prepare('SELECT detail_json FROM audit_log WHERE action = ?')
      .all(action)
      .map((r) => JSON.parse((r as { detail_json: string }).detail_json));
  return { t, pp, itemId: item.body.id as number, negId: neg.body.id as number, audits };
}

describe('auth', () => {
  it('rejects /api requests without the token but leaves health public', async () => {
    const { t } = await setup();
    expect((await t.request('/api/wishlist')).status).toBe(401);
    expect(
      (await t.request('/api/wishlist', { headers: { Authorization: 'Bearer wrong' } })).status,
    ).toBe(401);
    expect((await t.request('/api/health')).status).toBe(200);
  });
});

describe('max-price enforcement (server-side)', () => {
  it('rejects a payment above max_price, logs it, and never calls PayPal', async () => {
    const { t, pp, negId, audits } = await setup(100);
    // Even a confirmed price cannot exceed the cap...
    const confirm = await t.json('POST', `/api/negotiations/${negId}/confirm-price`, {
      agreed_price: 120,
    });
    expect(confirm.status).toBe(422);
    expect(confirm.body.error.code).toBe('exceeds_max_price');

    await t.json('POST', `/api/negotiations/${negId}/confirm-price`, { agreed_price: 85 });
    // ...and a direct payment request above the cap is refused.
    const res = await t.json('POST', '/api/payments/create', {
      negotiation_id: negId,
      amount: 120,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('exceeds_max_price');
    expect(pp.calls.create).toHaveLength(0);
    expect(audits('payment.rejected')).toEqual([
      expect.objectContaining({
        negotiation_id: negId,
        requested_amount: 120,
        max_price: 100,
        code: 'exceeds_max_price',
      }),
    ]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM payments').get()).toEqual({ n: 0 });
  });

  it('re-checks the cap at payment time if max_price was lowered after the price was agreed', async () => {
    const { t, pp, itemId, negId } = await setup(100);
    await t.json('POST', `/api/negotiations/${negId}/confirm-price`, { agreed_price: 95 });
    await t.json('PATCH', `/api/wishlist/${itemId}`, { max_price: 90 });
    const res = await t.json('POST', '/api/payments/create', { negotiation_id: negId, amount: 95 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('exceeds_max_price');
    expect(pp.calls.create).toHaveLength(0);
  });

  it('rejects payment before the user confirms a price, and when no max_price is set', async () => {
    const a = await setup(100);
    expect(
      (await a.t.json('POST', '/api/payments/create', { negotiation_id: a.negId, amount: 50 })).body
        .error.code,
    ).toBe('negotiation_not_agreed');
    await a.t.close();
    close = undefined;

    const b = await setup(null);
    await b.t.json('POST', `/api/negotiations/${b.negId}/confirm-price`, { agreed_price: 50 });
    expect(
      (await b.t.json('POST', '/api/payments/create', { negotiation_id: b.negId, amount: 50 })).body
        .error.code,
    ).toBe('no_max_price');
    expect(b.pp.calls.create).toHaveLength(0);
  });

  it('blocks capture if PayPal reports an amount different from our record', async () => {
    const { t, pp, negId, audits } = await setup(100);
    await t.json('POST', `/api/negotiations/${negId}/confirm-price`, { agreed_price: 85 });
    const created = await t.json('POST', '/api/payments/create', {
      negotiation_id: negId,
      amount: 85,
    });
    const order = pp.orders.get(created.body.paypal_order_id)!;
    order.purchase_units![0]!.amount!.value = '185.00';
    pp.approve(order.id);
    const res = await t.json('GET', `/api/payments/${created.body.id}`);
    expect(res.body.status).toBe('CAPTURE_BLOCKED');
    expect(pp.calls.capture).toBe(0);
    expect(audits('payment.capture_blocked')).toHaveLength(1);
  });
});

describe('payment lifecycle', () => {
  it('creates an order at the agreed price, is idempotent, captures after approval, and marks paid', async () => {
    const { t, pp, itemId, negId, audits } = await setup(100);
    await t.json('POST', `/api/negotiations/${negId}/confirm-price`, { agreed_price: 85 });

    const first = await t.json('POST', '/api/payments/create', {
      negotiation_id: negId,
      amount: 85,
    });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({
      amount: 85,
      currency: 'USD',
      status: 'PAYER_ACTION_REQUIRED',
    });
    expect(first.body.approve_url).toContain('sandbox.paypal.com');
    expect(pp.calls.create[0]).toMatchObject({ amountValue: '85.00', currency: 'USD' });
    expect(pp.calls.create[0]!.requestId).toBe(first.body.idempotency_key);

    const replay = await t.json('POST', '/api/payments/create', {
      negotiation_id: negId,
      amount: 85,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(pp.calls.create).toHaveLength(1);

    // Not approved yet: polling keeps the PayPal status and does not capture.
    expect((await t.json('GET', `/api/payments/${first.body.id}`)).body.status).toBe(
      'PAYER_ACTION_REQUIRED',
    );
    expect(pp.calls.capture).toBe(0);

    pp.approve(first.body.paypal_order_id);
    const done = await t.json('GET', `/api/payments/${first.body.id}`);
    expect(done.body.status).toBe('COMPLETED');
    expect(pp.calls.capture).toBe(1);

    expect((await t.json('GET', `/api/negotiations/${negId}`)).body.status).toBe('paid');
    expect(
      (await t.json('GET', '/api/wishlist')).body.items.find((i: { id: number }) => i.id === itemId)
        .status,
    ).toBe('purchased');
    expect(audits('payment.completed')).toHaveLength(1);

    // Paid negotiations cannot be paid again.
    expect(
      (await t.json('POST', '/api/payments/create', { negotiation_id: negId, amount: 85 })).body
        .error.code,
    ).toBe('already_paid');
  });

  it('rejects reuse of an Idempotency-Key for a different payment', async () => {
    const { t, negId } = await setup(100);
    await t.json('POST', `/api/negotiations/${negId}/confirm-price`, { agreed_price: 85 });
    const h = { 'Idempotency-Key': 'client-key-123' };
    expect(
      (await t.json('POST', '/api/payments/create', { negotiation_id: negId, amount: 85 }, h))
        .status,
    ).toBe(201);
    await t.json('POST', `/api/negotiations/${negId}/confirm-price`, { agreed_price: 80 });
    const res = await t.json(
      'POST',
      '/api/payments/create',
      { negotiation_id: negId, amount: 80 },
      h,
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('idempotency_key_reused');
  });

  it('returns 503 not_configured when PayPal credentials are missing (after policy passes)', async () => {
    const t = await startTestApp();
    close = t.close;
    const item = await t.json('POST', '/api/wishlist', { title: 'x', max_price: 10 });
    const neg = await t.json('POST', '/api/negotiations', {
      item_id: item.body.id,
      platform: 'mock_seller',
    });
    await t.json('POST', `/api/negotiations/${neg.body.id}/confirm-price`, { agreed_price: 10 });
    const res = await t.json('POST', '/api/payments/create', {
      negotiation_id: neg.body.id,
      amount: 10,
    });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('not_configured');
  });
});

describe('wishlist validation', () => {
  it('validates bodies and logs max_price changes', async () => {
    const { t, itemId, audits } = await setup(100);
    expect((await t.json('POST', '/api/wishlist', { title: '' })).status).toBe(400);
    expect(
      (await t.json('POST', '/api/wishlist', { title: 'x', target_price: 50, max_price: 40 }))
        .status,
    ).toBe(400);
    expect((await t.json('POST', '/api/wishlist', { title: 'x', max_price: 10.001 })).status).toBe(
      400,
    );
    expect((await t.json('POST', '/api/wishlist', { title: 'x', user_id: 2 })).status).toBe(400);
    expect((await t.json('PATCH', `/api/wishlist/${itemId}`, { target_price: 150 })).status).toBe(
      400,
    );
    expect((await t.json('PATCH', '/api/wishlist/9999', { title: 'y' })).status).toBe(404);
    await t.json('PATCH', `/api/wishlist/${itemId}`, { max_price: 120 });
    expect(audits('wishlist.updated').at(-1)).toMatchObject({ max_price: { from: 100, to: 120 } });
  });
});
