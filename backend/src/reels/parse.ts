import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Instagram messaging webhook parsing. Shape verified against Meta docs (Messenger Platform >
 * Instagram > Webhooks, updated Oct 2026): `object: "instagram"`, `entry[].messaging[]` with
 * sender/recipient ids and `message.{mid,text,attachments[{type,payload{url,title?}}],is_echo}`.
 * Attachment types include image, video, share (legacy), ig_post, ig_reel, reel, story_mention.
 * For shares, Meta only includes the URL of the shared media (and a title for reels).
 */

const Attachment = z
  .object({
    type: z.string(),
    payload: z
      .object({ url: z.string().optional(), title: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const Messaging = z
  .object({
    sender: z.object({ id: z.string() }),
    recipient: z.object({ id: z.string() }),
    timestamp: z.number().optional(),
    message: z
      .object({
        mid: z.string(),
        text: z.string().optional(),
        attachments: z.array(Attachment).optional(),
        is_echo: z.boolean().optional(),
        is_deleted: z.boolean().optional(),
        is_unsupported: z.boolean().optional(),
        is_self: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const InstagramWebhook = z.object({
  object: z.string(),
  entry: z.array(
    z
      .object({
        id: z.string(),
        time: z.number().optional(),
        messaging: z.array(Messaging).optional(),
      })
      .passthrough(),
  ),
});

export type ShareKind = 'reel' | 'post' | 'image' | 'link';

export interface IncomingDm {
  mid: string;
  senderId: string;
  recipientId: string;
  text: string | null;
  /** First shared media/link found (attachment or URL in text). */
  share: { kind: ShareKind; url: string | null; caption: string | null } | null;
  /** A user-supplied image (screenshot), usable for vision. */
  imageUrl: string | null;
}

/** Instagram post/reel URLs, including /share/ short links. */
export const INSTAGRAM_URL =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reels?|p|tv|share(?:\/(?:reel|p))?)\/[\w-]+\/?(?:\?[^\s]*)?/i;

export function findInstagramUrl(text: string | null | undefined): string | null {
  return text?.match(INSTAGRAM_URL)?.[0] ?? null;
}

/** Strip tracking query params (igsh, utm_*) so the same reel maps to one URL. */
export function canonicalInstagramUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/?$/, '/');
  } catch {
    return url;
  }
}

/** One event per incoming user message. Echoes, deletions, self-tests and unsupported media are dropped. */
export function parseInstagramWebhook(body: unknown): IncomingDm[] {
  const parsed = InstagramWebhook.safeParse(body);
  if (!parsed.success || parsed.data.object !== 'instagram') return [];
  const out: IncomingDm[] = [];
  for (const entry of parsed.data.entry) {
    for (const m of entry.messaging ?? []) {
      const msg = m.message;
      if (!msg || msg.is_echo || msg.is_deleted || msg.is_unsupported || msg.is_self) continue;
      let share: IncomingDm['share'] = null;
      let imageUrl: string | null = null;
      for (const a of msg.attachments ?? []) {
        const url = a.payload?.url ?? null;
        const title = a.payload?.title ?? null;
        if (a.type === 'ig_reel' || a.type === 'reel')
          share ??= { kind: 'reel', url, caption: title };
        else if (a.type === 'ig_post' || a.type === 'share')
          share ??= { kind: 'post', url, caption: title };
        else if (a.type === 'image' && url) imageUrl ??= url;
      }
      const linkInText = findInstagramUrl(msg.text);
      if (!share && linkInText)
        share = { kind: 'link', url: canonicalInstagramUrl(linkInText), caption: null };
      out.push({
        mid: msg.mid,
        senderId: m.sender.id,
        recipientId: m.recipient.id,
        text: msg.text?.trim() || null,
        share,
        imageUrl,
      });
    }
  }
  return out;
}

/** Validates `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(app secret, raw body). */
export function verifyMetaSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(header.slice(7), 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** One-time link codes: "FG-" + 6 chars from an unambiguous alphabet (no 0/O/1/I/L). */
export const LINK_CODE = /\bFG-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}\b/i;
export const findLinkCode = (text: string | null) =>
  text?.match(LINK_CODE)?.[0]?.toUpperCase() ?? null;

/** "2", "#2", "option 2", "2." -> 2 */
export function parseChoice(text: string | null, max: number): number | null {
  const m = text?.trim().match(/^(?:option\s*|#)?(\d{1,2})\.?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= max ? n : null;
}
