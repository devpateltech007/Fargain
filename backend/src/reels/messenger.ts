/**
 * Instagram DM replies via the Messenger Platform Send API (verified against Meta docs, Jul 2026):
 *   POST https://graph.facebook.com/<ver>/me/messages?access_token=<PAGE_ACCESS_TOKEN>
 *   { "recipient": { "id": "<IGSID>" }, "message": { "text": "..." } }   (text <= 1000 bytes)
 * Requires a Page access token with instagram_manage_messages for the Page linked to the account.
 */
export interface Messenger {
  sendText(recipientId: string, text: string): Promise<void>;
}

export class MessengerError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'MessengerError';
  }
}

/** Trim to Meta's 1000-byte limit without splitting a UTF-8 character. */
export function clampToBytes(text: string, maxBytes = 1000): string {
  const enc = new TextEncoder();
  if (enc.encode(text).length <= maxBytes) return text;
  let out = '';
  for (const ch of text) {
    if (enc.encode(`${out}${ch}…`).length > maxBytes) break;
    out += ch;
  }
  return `${out}…`;
}

export function createMessenger(opts: {
  accessToken: string;
  graphVersion: string;
  fetchImpl?: typeof fetch;
}): Messenger {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async sendText(recipientId, text) {
      const url = new URL(`https://graph.facebook.com/${opts.graphVersion}/me/messages`);
      url.searchParams.set('access_token', opts.accessToken);
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: clampToBytes(text) },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; code?: number };
        };
        // Never include the token (it is only in the URL we don't log).
        throw new MessengerError(
          res.status,
          `Send API HTTP ${res.status} ${body.error?.code ?? ''} ${String(body.error?.message ?? '').slice(0, 200)}`.trim(),
        );
      }
    },
  };
}
