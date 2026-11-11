import type { NegotiationDraft, PriceAssessment, RiskFlag } from '@fargain/shared';
import { BACKEND_URL } from '../config';

/** Settings live in chrome.storage.local, never in the bundle. */
export interface Settings {
  backendUrl: string;
  apiToken: string;
}

export async function loadSettings(): Promise<Settings> {
  const s = (await chrome.storage.local.get(['backendUrl', 'apiToken'])) as Partial<Settings>;
  return { backendUrl: s.backendUrl || BACKEND_URL, apiToken: s.apiToken ?? '' };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set(s);
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export interface WishlistItem {
  id: number;
  title: string;
  source_url?: string | null;
  target_price: number | null;
  max_price: number | null;
  status: string;
}

export interface MessageView {
  id: number;
  role: 'buyer_draft' | 'buyer_sent' | 'seller';
  text: string;
  created_at: string;
  ai: Record<string, unknown> | null;
}

export interface NegotiationView {
  id: number;
  item_id: number;
  platform: string;
  listing_url: string | null;
  status: 'open' | 'agreed' | 'paid' | 'abandoned';
  agreed_price: number | null;
  assessment: PriceAssessment | null;
  item: WishlistItem;
  messages: MessageView[];
}

export interface DraftResponse {
  message: MessageView;
  draft: NegotiationDraft;
  blocked: boolean;
  violations: { code: string; detail: string }[];
  risk_flags: RiskFlag[];
  assessment: PriceAssessment | null;
}

export interface SellerMessageResponse {
  message: MessageView;
  risk_flags: RiskFlag[];
  agreement: {
    agreed: boolean;
    price?: number;
    evidence_quote: string;
    exceeds_max_price: boolean;
  } | null;
  agreement_error?: string;
}

export interface PaymentView {
  id: number;
  amount: number;
  currency: string;
  status: string;
  approve_url: string | null;
  paypal_order_id: string | null;
}

export interface OfferView {
  domain: string;
  price: number;
  compare_at_price: number | null;
  url: string | null;
  excluded: string | null;
}

export interface DiscountedView {
  domain?: string;
  base_price: number;
  final_price: number;
  applied: { label: string; percent: number; savings: number }[];
  skipped: { label: string; reason: string }[];
}

export interface PricingLookupView {
  query: string;
  query_source: string;
  matched_products: { id: string; title: string; brand: string | null; image_url: string | null }[];
  offers: OfferView[];
  best_offer: OfferView | null;
  fair_price: number | null;
  offer_count_used: number;
  alternatives: {
    product_id: string;
    title: string;
    lowest_price: number;
    domain: string;
    url: string | null;
  }[];
  discounts: {
    profile_discounts: number;
    offers: DiscountedView[];
    best_after_discounts: DiscountedView | null;
  };
  current: (DiscountedView & { price: number; retailer: string | null }) | null;
  savings_vs_current: number | null;
}

export interface AlertView {
  id: number;
  item_id: number;
  item_title?: string;
  price: number;
  retailer: string | null;
  url: string | null;
  created_at: string;
  detail: { source?: string; previous_low?: number | null; target_price?: number | null };
}

export interface ProfileView {
  student: boolean;
  birthday?: string;
  memberships: string[];
  discounts: {
    label: string;
    percent: number;
    domains: string[];
    requires: 'none' | 'student' | 'birthday_month';
  }[];
}

export function createApi(settings: Settings) {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${settings.backendUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${settings.apiToken}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code: string; message: string; details?: unknown };
    };
    if (!res.ok) {
      throw new ApiRequestError(
        res.status,
        json.error?.code ?? 'http_error',
        json.error?.message ?? `HTTP ${res.status}`,
        json.error?.details,
      );
    }
    return json as T;
  }

  return {
    health: () => call<{ ok: boolean; llm_configured: boolean }>('GET', '/api/health'),
    wishlist: () => call<{ items: WishlistItem[] }>('GET', '/api/wishlist'),
    createItem: (b: {
      title: string;
      target_price?: number;
      max_price?: number;
      source_url?: string;
      image_url?: string;
    }) => call<WishlistItem>('POST', '/api/wishlist', { ...b, source: 'manual' }),
    findNegotiations: (listingUrl: string) =>
      call<{ negotiations: { id: number }[] }>(
        'GET',
        `/api/negotiations?listing_url=${encodeURIComponent(listingUrl)}`,
      ),
    negotiation: (id: number) => call<NegotiationView>('GET', `/api/negotiations/${id}`),
    createNegotiation: (b: unknown) => call<NegotiationView>('POST', '/api/negotiations', b),
    draft: (id: number, instructions?: string) =>
      call<DraftResponse>(
        'POST',
        `/api/negotiations/${id}/draft`,
        instructions ? { instructions } : {},
      ),
    sellerMessage: (id: number, text: string) =>
      call<SellerMessageResponse>('POST', `/api/negotiations/${id}/seller-message`, { text }),
    buyerMessage: (id: number, text: string, draftId?: number) =>
      call<{ message: MessageView }>('POST', `/api/negotiations/${id}/buyer-message`, {
        text,
        ...(draftId ? { draft_message_id: draftId } : {}),
      }),
    confirmPrice: (id: number, agreed_price: number) =>
      call<NegotiationView>('POST', `/api/negotiations/${id}/confirm-price`, { agreed_price }),
    createPayment: (negotiation_id: number, amount: number) =>
      call<PaymentView>('POST', '/api/payments/create', { negotiation_id, amount }),
    payment: (id: number) => call<PaymentView>('GET', `/api/payments/${id}`),
    pricingLookup: (b: {
      query?: string;
      product_title?: string;
      brand?: string;
      item_id?: number;
      current_price?: number;
      current_retailer?: string;
    }) => call<PricingLookupView>('POST', '/api/pricing/lookup', b),
    alerts: (unseen = true) => call<{ alerts: AlertView[] }>('GET', `/api/alerts?unseen=${unseen}`),
    markAlertSeen: async (id: number) => {
      await fetch(`${settings.backendUrl.replace(/\/$/, '')}/api/alerts/${id}/seen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${settings.apiToken}` },
      });
    },
    profile: () => call<{ profile: ProfileView }>('GET', '/api/profile'),
    saveProfile: (p: ProfileView) => call<{ profile: ProfileView }>('PUT', '/api/profile', p),
    simulateDrop: (itemId: number) =>
      call<{ simulated: true; alert: AlertView }>(
        'POST',
        `/api/dev/simulate-price-drop/${itemId}`,
        {},
      ),
  };
}

export type Api = ReturnType<typeof createApi>;
