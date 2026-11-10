/**
 * Smoke test against a running backend (npm run dev:backend). Uses the scripted seller bot
 * in-process to play the seller side. Works without an LLM (checks guardrails + flags); with an
 * LLM configured it also drafts each buyer turn.
 *
 *   npm run smoke:negotiation            # standard seller
 *   npm run smoke:negotiation -- scam    # scam seller
 */
import { getConfig } from '../backend/src/config.js';
// @ts-expect-error plain JS module shared with the browser page
import { createSellerBot } from '../mock-seller/seller-bot.js';

const env = getConfig();
const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
const scenario = process.argv.includes('scam') ? 'scam' : 'standard';
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
if (env.FARGAIN_API_TOKEN) headers.Authorization = `Bearer ${env.FARGAIN_API_TOKEN}`;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const page = await fetch(`${base}/mock-seller/`);
console.log(
  `mock seller page -> HTTP ${page.status}, has compose box: ${(await page.text()).includes('data-testid="compose"')}`,
);
const health = (await api('GET', '/api/health')).body;
console.log(`llm configured: ${health.llm_configured}`);

const item = await api('POST', '/api/wishlist', {
  title: 'Smoke: Sony WH-1000XM5',
  target_price: 130,
  max_price: 160,
});
const neg = await api('POST', '/api/negotiations', {
  item_id: item.body.id,
  platform: 'mock_seller',
  listing_url: `${base}/mock-seller/?scenario=${scenario}&run=smoke${Date.now()}`,
  listing: { title: 'Sony WH-1000XM5', price: 180, currency: 'USD', description: 'Barely used.' },
});
const id = neg.body.id as number;
console.log(`negotiation #${id} (${scenario})`);

const unsafe = await api('POST', `/api/negotiations/${id}/buyer-message`, {
  text: 'My max is 160, can you do 150?',
});
console.log(`budget-revealing message rejected: ${unsafe.status === 422}`);
const over = await api('POST', `/api/negotiations/${id}/buyer-message`, { text: 'OK $175 works.' });
console.log(`over-max message rejected: ${over.status === 422}`);

const bot = createSellerBot({ scenario });
const scripted = ['Hi! Is this still available?', 'Would you take $125?', 'How about $145?'];
for (let turn = 0; turn < scripted.length; turn++) {
  let text = scripted[turn]!;
  if (health.llm_configured) {
    const d = await api('POST', `/api/negotiations/${id}/draft`, {});
    if (d.status !== 200) {
      console.log(`draft failed: ${JSON.stringify(d.body)}`);
      process.exit(1);
    }
    console.log(
      `  agent draft: "${d.body.draft.draft_message}" (offer ${d.body.draft.proposed_offer}, blocked=${d.body.blocked})`,
    );
    if (d.body.blocked) break;
    text = d.body.draft.draft_message;
  }
  const b = await api('POST', `/api/negotiations/${id}/buyer-message`, { text });
  console.log(`buyer: ${text} -> ${b.status}`);
  const reply = bot.reply(text) as string;
  const s = await api('POST', `/api/negotiations/${id}/seller-message`, { text: reply });
  console.log(`seller: ${reply}`);
  if (s.body.risk_flags.length)
    console.log(`  flags: ${s.body.risk_flags.map((f: { code: string }) => f.code).join(', ')}`);
  if (s.body.agreement?.agreed) {
    console.log(
      `  agreement detected at ${s.body.agreement.price} (exceeds max: ${s.body.agreement.exceeds_max_price})`,
    );
    break;
  }
}
