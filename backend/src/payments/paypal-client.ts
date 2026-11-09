import { PAYPAL_API_BASE } from '../config.js';

/**
 * Minimal PayPal REST client (sandbox only). Behavior verified against the sandbox with
 * scripts/probe-paypal-orders.ts:
 *  - POST /v2/checkout/orders with payment_source.paypal.experience_context returns status
 *    PAYER_ACTION_REQUIRED and a `payer-action` link (not `approve`).
 *  - Repeating the same PayPal-Request-Id returns the same order (idempotent).
 *  - Capturing before buyer approval -> 422 ORDER_NOT_APPROVED.
 */

export interface PayPalLink {
  rel: string;
  href: string;
  method?: string;
}

export interface PayPalOrder {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: {
    reference_id?: string;
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: {
      captures?: {
        id: string;
        status: string;
        amount?: { currency_code: string; value: string };
      }[];
    };
  }[];
}

export interface CreateOrderInput {
  requestId: string;
  amountValue: string; // e.g. "85.00"
  currency: string;
  description: string;
  customId: string;
  returnUrl: string;
  cancelUrl: string;
}

export interface WebhookVerificationInput {
  headers: Record<string, string | undefined>;
  webhookId: string;
  event: unknown;
}

export interface PayPalApi {
  createOrder(input: CreateOrderInput): Promise<PayPalOrder>;
  getOrder(orderId: string): Promise<PayPalOrder>;
  captureOrder(orderId: string, requestId: string): Promise<PayPalOrder>;
  verifyWebhookSignature(input: WebhookVerificationInput): Promise<boolean>;
}

export class PayPalError extends Error {
  constructor(
    public readonly status: number,
    public readonly paypalName: string | undefined,
    public readonly issue: string | undefined,
    public readonly debugId: string | undefined,
  ) {
    super(
      `PayPal API error HTTP ${status}${paypalName ? ` ${paypalName}` : ''}${issue ? ` (${issue})` : ''}`,
    );
    this.name = 'PayPalError';
  }
}

export function approvalUrl(order: PayPalOrder): string | undefined {
  return order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
}

export function createPayPalClient(clientId: string, clientSecret: string): PayPalApi {
  let token: { value: string; expiresAt: number } | undefined;

  async function accessToken(): Promise<string> {
    if (token && Date.now() < token.expiresAt - 60_000) return token.value;
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok)
      throw new PayPalError(
        res.status,
        'OAUTH_FAILED',
        undefined,
        res.headers.get('paypal-debug-id') ?? undefined,
      );
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  }

  async function call<T>(
    method: string,
    path: string,
    opts: { body?: unknown; requestId?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    if (opts.requestId) headers['PayPal-Request-Id'] = opts.requestId;
    const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const json = (await res.json().catch(() => ({}))) as T & {
      name?: string;
      details?: { issue?: string }[];
      debug_id?: string;
    };
    if (!res.ok)
      throw new PayPalError(res.status, json.name, json.details?.[0]?.issue, json.debug_id);
    return json;
  }

  return {
    createOrder: (i) =>
      call<PayPalOrder>('POST', '/v2/checkout/orders', {
        requestId: i.requestId,
        body: {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: i.customId,
              custom_id: i.customId,
              description: i.description.slice(0, 127),
              amount: { currency_code: i.currency, value: i.amountValue },
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'Fargain (sandbox)',
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
                return_url: i.returnUrl,
                cancel_url: i.cancelUrl,
              },
            },
          },
        },
      }),
    getOrder: (id) => call<PayPalOrder>('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`),
    captureOrder: (id, requestId) =>
      call<PayPalOrder>('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {
        requestId,
      }),
    verifyWebhookSignature: async ({ headers, webhookId, event }) => {
      const res = await call<{ verification_status: string }>(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        {
          body: {
            auth_algo: headers['paypal-auth-algo'],
            cert_url: headers['paypal-cert-url'],
            transmission_id: headers['paypal-transmission-id'],
            transmission_sig: headers['paypal-transmission-sig'],
            transmission_time: headers['paypal-transmission-time'],
            webhook_id: webhookId,
            webhook_event: event,
          },
        },
      );
      return res.verification_status === 'SUCCESS';
    },
  };
}
