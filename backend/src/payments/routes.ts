import { CreatePaymentBody } from '@fargain/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../audit.js';
import { requireFeature } from '../config.js';
import { ApiError, notFound } from '../http/errors.js';
import { getPayment, getPaymentByOrderId } from '../store.js';
import { createPaymentService } from './service.js';

const IdParams = z.object({ id: z.coerce.number().int().positive() });
const ReturnQuery = z.object({ token: z.string().min(1).max(64).optional() }).passthrough();

const WebhookEvent = z
  .object({
    id: z.string(),
    event_type: z.string(),
    resource: z
      .object({
        id: z.string().optional(),
        supplementary_data: z
          .object({ related_ids: z.object({ order_id: z.string().optional() }).partial() })
          .partial()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const page = (title: string, message: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;max-width:560px">
<h1>${title}</h1><p>${message}</p><p>You can close this tab and return to Fargain.</p></body></html>`;

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  const { db, env, userId } = app.deps;
  const service = createPaymentService({ db, env, userId, paypal: app.deps.paypal });

  app.post('/api/payments/create', async (req, reply) => {
    const body = CreatePaymentBody.parse(req.body);
    const header = req.headers['idempotency-key'];
    const { payment, replay } = await service.create(
      body,
      typeof header === 'string' ? header : undefined,
    );
    return reply.status(replay ? 200 : 201).send(payment);
  });

  app.get('/api/payments/:id', async (req) => {
    const { id } = IdParams.parse(req.params);
    const payment = getPayment(db, userId, id);
    if (!payment) throw notFound('payment');
    return service.refresh(payment);
  });

  // PayPal redirects the buyer here after approval (?token=<orderId>&PayerID=...).
  app.get('/paypal/return', async (req, reply) => {
    const { token } = ReturnQuery.parse(req.query);
    const payment = token ? getPaymentByOrderId(db, token) : undefined;
    reply.type('text/html');
    if (!payment)
      return reply
        .status(404)
        .send(page('Payment not found', 'This PayPal order is not known to Fargain.'));
    const updated = await service.refresh(payment);
    if (updated.status === 'COMPLETED') {
      return page(
        'Payment complete',
        `Paid ${updated.amount.toFixed(2)} ${updated.currency} (PayPal sandbox).`,
      );
    }
    return page('Payment pending', `Current status: ${updated.status.replace(/[^A-Z_]/g, '')}.`);
  });

  app.get('/paypal/cancel', async (_req, reply) => {
    reply.type('text/html');
    return page(
      'Payment cancelled',
      'No money moved. You can create the payment again from Fargain.',
    );
  });

  /**
   * PayPal webhook. Requires PAYPAL_WEBHOOK_ID; every event is verified with PayPal's
   * verify-webhook-signature API before it is acted on. Local dev relies on polling
   * (GET /api/payments/:id) and the return URL instead, because PayPal only delivers webhooks
   * to public HTTPS URLs.
   */
  app.post('/api/payments/webhook', async (req, reply) => {
    requireFeature(env, 'paypalWebhook');
    const headers = Object.fromEntries(
      [
        'paypal-auth-algo',
        'paypal-cert-url',
        'paypal-transmission-id',
        'paypal-transmission-sig',
        'paypal-transmission-time',
      ].map((h) => [
        h,
        typeof req.headers[h] === 'string' ? (req.headers[h] as string) : undefined,
      ]),
    );
    if (Object.values(headers).some((v) => !v))
      throw new ApiError(400, 'invalid_signature', 'missing PayPal signature headers');

    const verified = await app.deps
      .paypal()
      .verifyWebhookSignature({ headers, webhookId: env.PAYPAL_WEBHOOK_ID!, event: req.body });
    if (!verified) {
      audit(db, {
        userId: null,
        actor: 'system',
        action: 'paypal.webhook_rejected',
        detail: { transmission_id: headers['paypal-transmission-id'] },
      });
      throw new ApiError(400, 'invalid_signature', 'webhook signature verification failed');
    }

    const event = WebhookEvent.parse(req.body);
    const orderId = event.event_type.startsWith('CHECKOUT.ORDER.')
      ? event.resource.id
      : event.resource.supplementary_data?.related_ids?.order_id;
    audit(db, {
      userId: null,
      actor: 'system',
      action: 'paypal.webhook_received',
      detail: { event_id: event.id, event_type: event.event_type, order_id: orderId },
    });

    const payment = orderId ? getPaymentByOrderId(db, orderId) : undefined;
    if (payment) await service.refresh(payment);
    return reply.status(200).send({ received: true });
  });
}
