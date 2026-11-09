/**
 * Sandbox probe for Orders v2 behavior we rely on. Prints only non-secret fields
 * (order id, status, link rels/hosts). Creates one unapproved $1.00 sandbox order.
 */
import { randomUUID } from 'node:crypto';
import { PAYPAL_API_BASE, getConfig, requireFeature } from '../backend/src/config.js';

const env = getConfig();
requireFeature(env, 'paypal');

const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
const tokRes = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
  method: 'POST',
  headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
});
const { access_token } = (await tokRes.json()) as { access_token: string };
const auth = { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' };

const requestId = randomUUID();
const body = {
  intent: 'CAPTURE',
  purchase_units: [
    {
      reference_id: 'probe',
      description: 'Fargain probe',
      amount: { currency_code: 'USD', value: '1.00' },
    },
  ],
  payment_source: {
    paypal: {
      experience_context: {
        return_url: 'http://localhost:3000/paypal/return',
        cancel_url: 'http://localhost:3000/paypal/cancel',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    },
  },
};

type Order = {
  id: string;
  status: string;
  links?: { rel: string; href: string; method?: string }[];
};
const summarize = (o: Order) =>
  `id=${o.id} status=${o.status} links=[${(o.links ?? []).map((l) => `${l.rel}:${l.method ?? 'GET'}:${new URL(l.href).host}`).join(', ')}]`;

async function create(prefer: string) {
  const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: 'POST',
    headers: { ...auth, 'PayPal-Request-Id': requestId, Prefer: prefer },
    body: JSON.stringify(body),
  });
  const j = (await res.json()) as Order & { name?: string; details?: unknown };
  return { status: res.status, j };
}

const a = await create('return=representation');
console.log(
  `create #1 -> HTTP ${a.status} ${a.status < 300 ? summarize(a.j) : JSON.stringify(a.j)}`,
);
const b = await create('return=representation');
console.log(
  `create #2 (same PayPal-Request-Id) -> HTTP ${b.status} ${b.status < 300 ? summarize(b.j) : JSON.stringify(b.j)}`,
);
console.log(`idempotent: ${a.j.id === b.j.id}`);

const g = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${a.j.id}`, { headers: auth });
const gj = (await g.json()) as Order;
console.log(`get -> HTTP ${g.status} ${summarize(gj)}`);

const c = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${a.j.id}/capture`, {
  method: 'POST',
  headers: { ...auth, 'PayPal-Request-Id': randomUUID() },
});
const cj = (await c.json()) as { name?: string; details?: { issue?: string }[] };
console.log(
  `capture before approval -> HTTP ${c.status} name=${cj.name} issue=${cj.details?.[0]?.issue}`,
);
