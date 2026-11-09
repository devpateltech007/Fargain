import { toCents, type CreatePaymentBody } from '@fargain/shared';
import { audit } from '../audit.js';
import type { Env } from '../config.js';
import type { Db } from '../db/index.js';
import { ApiError, notFound } from '../http/errors.js';
import { NOW_SQL, getNegotiation, getPayment, type PaymentRow } from '../store.js';
import { approvalUrl, type PayPalApi, type PayPalOrder } from './paypal-client.js';
import { centsToValue, evaluatePaymentRequest, exceedsMaxPrice } from './policy.js';

/** Local statuses used before/without a PayPal order. Everything else is a PayPal order status. */
export const LOCAL_STATUS = {
  pending: 'PENDING_CREATE',
  failed: 'CREATE_FAILED',
  blocked: 'CAPTURE_BLOCKED',
} as const;
const TERMINAL = new Set(['COMPLETED', 'VOIDED', LOCAL_STATUS.blocked]);
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;

export interface PaymentServiceDeps {
  db: Db;
  env: Env;
  userId: number;
  /** Resolves the PayPal client; throws MissingConfigError when PayPal is not configured. */
  paypal: () => PayPalApi;
}

export function createPaymentService({ db, env, userId, paypal }: PaymentServiceDeps) {
  const update = (
    id: number,
    fields: Partial<Pick<PaymentRow, 'paypal_order_id' | 'status' | 'approve_url'>>,
  ) => {
    const cols = Object.keys(fields);
    db.prepare(
      `UPDATE payments SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = ${NOW_SQL} WHERE id = @id`,
    ).run({
      ...fields,
      id,
    });
  };

  async function create(
    body: CreatePaymentBody,
    idempotencyHeader?: string,
  ): Promise<{ payment: PaymentRow; replay: boolean }> {
    const found = getNegotiation(db, userId, body.negotiation_id);
    if (!found) throw notFound('negotiation');
    const { negotiation, item } = found;
    const currency = body.currency ?? env.PAYPAL_CURRENCY;

    // 1. Server-side policy. Runs before anything else, including config checks.
    const verdict = evaluatePaymentRequest({
      amount: body.amount,
      currency,
      expectedCurrency: env.PAYPAL_CURRENCY,
      maxPrice: item.max_price,
      agreedPrice: negotiation.agreed_price,
      negotiationStatus: negotiation.status,
    });
    if (!verdict.ok) {
      audit(db, {
        userId,
        actor: 'system',
        action: 'payment.rejected',
        detail: {
          negotiation_id: negotiation.id,
          item_id: item.id,
          requested_amount: body.amount,
          currency,
          max_price: item.max_price,
          agreed_price: negotiation.agreed_price,
          code: verdict.code,
        },
      });
      throw new ApiError(422, verdict.code, verdict.message);
    }

    // 2. Idempotency.
    if (idempotencyHeader !== undefined && !IDEMPOTENCY_KEY.test(idempotencyHeader)) {
      throw new ApiError(
        400,
        'invalid_request',
        'Idempotency-Key must be 8-100 chars of [A-Za-z0-9_-]',
      );
    }
    const key = idempotencyHeader ?? `fargain-neg${negotiation.id}-${verdict.amountCents}c`;
    const byKey = db.prepare('SELECT * FROM payments WHERE idempotency_key = ?').get(key) as
      PaymentRow | undefined;
    if (
      byKey &&
      (byKey.negotiation_id !== negotiation.id || toCents(byKey.amount) !== verdict.amountCents)
    ) {
      throw new ApiError(
        409,
        'idempotency_key_reused',
        'Idempotency-Key was already used for a different payment',
      );
    }
    if (byKey && byKey.status !== LOCAL_STATUS.failed) return { payment: byKey, replay: true };

    const active = db
      .prepare(
        `SELECT id FROM payments WHERE negotiation_id = ? AND idempotency_key != ? AND status NOT IN ('VOIDED', ?)`,
      )
      .get(negotiation.id, key, LOCAL_STATUS.failed) as { id: number } | undefined;
    if (active)
      throw new ApiError(
        409,
        'payment_exists',
        `payment ${active.id} already exists for this negotiation`,
      );

    const client = paypal(); // throws 503 not_configured if PayPal creds are missing

    // 3. Record intent before calling PayPal so a crash can't lose track of an order.
    let paymentId: number;
    if (byKey) {
      paymentId = byKey.id;
      update(paymentId, { status: LOCAL_STATUS.pending });
    } else {
      paymentId = Number(
        db
          .prepare(
            'INSERT INTO payments (negotiation_id, amount, currency, status, idempotency_key) VALUES (?, ?, ?, ?, ?)',
          )
          .run(negotiation.id, verdict.amountCents / 100, currency, LOCAL_STATUS.pending, key)
          .lastInsertRowid,
      );
    }

    let order: PayPalOrder;
    try {
      order = await client.createOrder({
        requestId: key,
        amountValue: centsToValue(verdict.amountCents),
        currency,
        description: `Fargain: ${item.title}`,
        customId: `fargain-payment-${paymentId}`,
        returnUrl: `${env.PUBLIC_BASE_URL}/paypal/return`,
        cancelUrl: `${env.PUBLIC_BASE_URL}/paypal/cancel`,
      });
    } catch (err) {
      update(paymentId, { status: LOCAL_STATUS.failed });
      audit(db, {
        userId,
        actor: 'system',
        action: 'payment.create_failed',
        detail: { payment_id: paymentId, error: String(err) },
      });
      throw err;
    }

    update(paymentId, {
      paypal_order_id: order.id,
      status: order.status,
      approve_url: approvalUrl(order) ?? null,
    });
    audit(db, {
      userId,
      actor: 'system',
      action: 'payment.created',
      detail: {
        payment_id: paymentId,
        negotiation_id: negotiation.id,
        amount: verdict.amountCents / 100,
        currency,
        paypal_order_id: order.id,
        max_price: item.max_price,
      },
    });
    return { payment: getPayment(db, userId, paymentId)!, replay: false };
  }

  /**
   * Pull the latest order state from PayPal. If the buyer approved it, capture it (the buyer's
   * approval on PayPal is the human authorization). Before capturing, re-check PayPal's amount
   * against our record and the item's max_price.
   */
  async function refresh(payment: PaymentRow): Promise<PaymentRow> {
    if (!payment.paypal_order_id || TERMINAL.has(payment.status)) return payment;
    const client = paypal();
    let order = await client.getOrder(payment.paypal_order_id);

    if (order.status === 'APPROVED') {
      const found = getNegotiation(db, userId, payment.negotiation_id);
      const unit = order.purchase_units?.[0]?.amount;
      const paypalCents = unit ? toCents(Number(unit.value)) : Number.NaN;
      const ourCents = toCents(payment.amount);
      if (
        !found ||
        paypalCents !== ourCents ||
        unit?.currency_code !== payment.currency ||
        exceedsMaxPrice(payment.amount, found.item.max_price)
      ) {
        update(payment.id, { status: LOCAL_STATUS.blocked });
        audit(db, {
          userId,
          actor: 'system',
          action: 'payment.capture_blocked',
          detail: {
            payment_id: payment.id,
            paypal_amount: unit?.value,
            paypal_currency: unit?.currency_code,
            our_amount: payment.amount,
            max_price: found?.item.max_price ?? null,
          },
        });
        return getPayment(db, userId, payment.id)!;
      }
      order = await client.captureOrder(
        payment.paypal_order_id,
        `${payment.idempotency_key}-capture`,
      );
      const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
      audit(db, {
        userId,
        actor: 'system',
        action: 'payment.captured',
        detail: {
          payment_id: payment.id,
          order_status: order.status,
          capture_id: capture?.id,
          capture_status: capture?.status,
        },
      });
    }

    if (order.status !== payment.status) {
      update(payment.id, { status: order.status });
      if (order.status === 'COMPLETED') markPaid(payment);
    }
    return getPayment(db, userId, payment.id)!;
  }

  function markPaid(payment: PaymentRow): void {
    db.transaction(() => {
      db.prepare(
        `UPDATE negotiations SET status = 'paid', updated_at = ${NOW_SQL} WHERE id = ?`,
      ).run(payment.negotiation_id);
      db.prepare(
        `UPDATE wishlist_items SET status = 'purchased', updated_at = ${NOW_SQL}
         WHERE id = (SELECT item_id FROM negotiations WHERE id = ?)`,
      ).run(payment.negotiation_id);
      audit(db, {
        userId,
        actor: 'system',
        action: 'payment.completed',
        detail: { payment_id: payment.id, amount: payment.amount, currency: payment.currency },
      });
    })();
  }

  return { create, refresh };
}

export type PaymentService = ReturnType<typeof createPaymentService>;
