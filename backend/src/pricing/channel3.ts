import { z } from 'zod';

/**
 * Channel3 product API client. Shapes verified LIVE with scripts/probe-channel3.ts (Nov 2026);
 * they differ from the docs example:
 *  - offer price is `price.price` (+ `compare_at_price`, `currency`), not `price.amount`
 *  - brand is `brands: [{id, name}]`
 *  - offers also carry `url` (buy link), `condition`, `availability`
 * Schemas are lenient (unknown fields pass through, optional fields may be null).
 */
export const CHANNEL3_BASE = 'https://api.trychannel3.com';

const Offer = z
  .object({
    url: z.string().optional(),
    domain: z.string(),
    price: z.object({
      price: z.number(),
      compare_at_price: z.number().nullable().optional(),
      currency: z.string(),
    }),
    availability: z.string().nullable().optional(),
    condition: z.string().nullable().optional(),
  })
  .passthrough();
export type Channel3Offer = z.infer<typeof Offer>;

export const Channel3Product = z
  .object({
    id: z.string(),
    title: z.string(),
    brands: z
      .array(z.object({ id: z.string().optional(), name: z.string() }).passthrough())
      .nullable()
      .optional(),
    images: z
      .array(
        z
          .object({ url: z.string(), is_main_image: z.boolean().nullable().optional() })
          .passthrough(),
      )
      .nullable()
      .optional(),
    category: z.object({ slug: z.string(), title: z.string() }).passthrough().nullable().optional(),
    offers: z.array(Offer).default([]),
  })
  .passthrough();
export type Channel3Product = z.infer<typeof Channel3Product>;

const SearchResponse = z.object({
  products: z.array(Channel3Product),
  next_page_token: z.string().nullable().optional(),
});

export interface Channel3Api {
  search(query: string, limit?: number): Promise<Channel3Product[]>;
  getProduct(id: string): Promise<Channel3Product | null>;
}

export class Channel3Error extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'Channel3Error';
  }
}

export function createChannel3Client(apiKey: string, fetchImpl: typeof fetch = fetch): Channel3Api {
  const headers = { 'x-api-key': apiKey, 'Content-Type': 'application/json' };
  return {
    async search(query, limit = 20) {
      const res = await fetchImpl(`${CHANNEL3_BASE}/v1/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query, limit: Math.min(30, Math.max(1, limit)) }),
      });
      if (!res.ok) throw new Channel3Error(res.status, `Channel3 search HTTP ${res.status}`);
      return SearchResponse.parse(await res.json()).products;
    },
    async getProduct(id) {
      const res = await fetchImpl(`${CHANNEL3_BASE}/v1/products/${encodeURIComponent(id)}`, {
        headers,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Channel3Error(res.status, `Channel3 product HTTP ${res.status}`);
      return Channel3Product.parse(await res.json());
    },
  };
}
