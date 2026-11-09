/**
 * Read-only probe of IG_ACCESS_TOKEN. Prints what kind of token it is and which Pages /
 * Instagram professional accounts it can see. Never prints the token.
 */
import { getConfig } from '../backend/src/config.js';

const env = getConfig();
const token = env.IG_ACCESS_TOKEN;
if (!token) {
  console.log('IG_ACCESS_TOKEN not set');
  process.exit(1);
}

async function get(host: string, p: string): Promise<{ status: number; body: unknown }> {
  const url = new URL(p, host);
  url.searchParams.set('access_token', token!);
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const errMsg = (b: unknown) =>
  (b as { error?: { message?: string; code?: number } })?.error
    ? `${(b as { error: { code?: number } }).error.code}: ${(b as { error: { message?: string } }).error.message}`
    : '';

console.log(
  `token prefix type: ${token.startsWith('EAA') ? 'Facebook Graph (EAA...)' : token.startsWith('IG') ? 'Instagram Login (IG...)' : 'unknown'}`,
);

const me = await get('https://graph.facebook.com', '/me?fields=id,name');
console.log(
  `graph.facebook.com /me -> HTTP ${me.status} ${me.status === 200 ? `name="${(me.body as { name?: string }).name}"` : errMsg(me.body)}`,
);

const accounts = await get(
  'https://graph.facebook.com',
  '/me/accounts?fields=name,instagram_business_account{id,username}',
);
if (accounts.status === 200) {
  const pages = (
    accounts.body as {
      data: { name: string; instagram_business_account?: { id: string; username?: string } }[];
    }
  ).data;
  console.log(`pages visible: ${pages.length}`);
  for (const p of pages) {
    const ig = p.instagram_business_account;
    console.log(
      `  page "${p.name}" -> ${ig ? `IG account @${ig.username ?? '?'} (id ${ig.id})` : 'no linked IG professional account'}`,
    );
  }
} else {
  console.log(`/me/accounts -> HTTP ${accounts.status} ${errMsg(accounts.body)}`);
}

const igMe = await get('https://graph.instagram.com', '/me?fields=user_id,username');
console.log(
  `graph.instagram.com /me -> HTTP ${igMe.status} ${igMe.status === 200 ? JSON.stringify(igMe.body) : errMsg(igMe.body)}`,
);
