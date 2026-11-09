/**
 * PayPal sandbox end-to-end check against a running backend (npm run dev:backend).
 *
 *   npm run e2e:paypal
 *
 * 1. Creates a wishlist item (max $100) and a negotiation.
 * 2. Confirms $120 (expects 422) and tries to pay $120 (expects 422, no PayPal order).
 * 3. Confirms $85 and creates a real sandbox order.
 * 4. Prints the approval URL: log in with the SANDBOX BUYER account and approve.
 * 5. Polls GET /api/payments/:id (which captures after approval) until COMPLETED.
 */
import { getConfig } from '../backend/src/config.js';

const env = getConfig();
const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (env.FARGAIN_API_TOKEN) headers.Authorization = `Bearer ${env.FARGAIN_API_TOKEN}`;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function expectStatus(label: string, got: number, want: number, body: unknown) {
  if (got !== want) {
    console.error(`FAIL ${label}: expected HTTP ${want}, got ${got}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  console.log(`ok   ${label} (HTTP ${got})`);
}

const health = await api('GET', '/api/health').catch(() => null);
if (!health || health.status !== 200) {
  console.error(`Backend not reachable at ${base}. Start it with: npm run dev:backend`);
  process.exit(1);
}

const item = await api('POST', '/api/wishlist', {
  title: 'E2E: Sony WH-1000XM5 (used)',
  source: 'manual',
  target_price: 80,
  max_price: 100,
});
expectStatus('create wishlist item (max $100)', item.status, 201, item.body);
const neg = await api('POST', '/api/negotiations', {
  item_id: item.body.id,
  platform: 'mock_seller',
  seller_label: 'E2E seller',
});
expectStatus('create negotiation', neg.status, 201, neg.body);

const over = await api('POST', `/api/negotiations/${neg.body.id}/confirm-price`, {
  agreed_price: 120,
});
expectStatus('confirm $120 is refused (above max)', over.status, 422, over.body);

const ok = await api('POST', `/api/negotiations/${neg.body.id}/confirm-price`, {
  agreed_price: 85,
});
expectStatus('confirm $85', ok.status, 200, ok.body);

const overPay = await api('POST', '/api/payments/create', {
  negotiation_id: neg.body.id,
  amount: 120,
});
expectStatus(
  'pay $120 is refused (above max), no PayPal order created',
  overPay.status,
  422,
  overPay.body,
);

const pay = await api('POST', '/api/payments/create', { negotiation_id: neg.body.id, amount: 85 });
expectStatus('create $85 sandbox order', pay.status, 201, pay.body);
const again = await api('POST', '/api/payments/create', {
  negotiation_id: neg.body.id,
  amount: 85,
});
expectStatus('repeat create is idempotent (same payment)', again.status, 200, again.body);
if (again.body.paypal_order_id !== pay.body.paypal_order_id) {
  console.error('FAIL idempotency: different PayPal order ids');
  process.exit(1);
}

console.log(`\nPayPal order ${pay.body.paypal_order_id} status ${pay.body.status}`);
console.log('\n>>> Open this URL, log in with the SANDBOX BUYER account, and approve:\n');
console.log(`    ${pay.body.approve_url}\n`);
console.log('Polling every 5s for up to 15 minutes...');

const deadline = Date.now() + 15 * 60_000;
let last = '';
while (Date.now() < deadline) {
  const p = await api('GET', `/api/payments/${pay.body.id}`);
  if (p.body.status !== last) {
    last = p.body.status;
    console.log(`  status: ${last}`);
  }
  if (last === 'COMPLETED') {
    const n = await api('GET', `/api/negotiations/${neg.body.id}`);
    console.log(`\nPASS: captured $85.00 in sandbox. Negotiation status: ${n.body.status}.`);
    process.exit(0);
  }
  if (last === 'CAPTURE_BLOCKED' || last === 'VOIDED') {
    console.error(`FAIL: payment ended in ${last}`);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 5000));
}
console.error('Timed out waiting for approval.');
process.exit(1);
