/**
 * All site-specific DOM logic lives behind this interface. Each adapter keeps its selectors in a
 * single `selectors.ts` file next to it, so a site redesign only touches one file.
 *
 * Sending is available only to the explicit, bounded autopilot flow. It must target the active
 * conversation's send control and fail closed when the control cannot be identified.
 */

export interface Listing {
  title: string;
  url: string;
  price?: number;
  currency?: string;
  sellerLabel?: string;
  imageUrl?: string;
  description?: string;
  /** Free-form extra facts (condition, location, ASIN...) the adapter could read. */
  attributes?: Record<string, string>;
}

export interface ConversationMessage {
  role: 'buyer' | 'seller';
  text: string;
  timestamp?: string;
}

export type SiteId = 'facebook_marketplace' | 'amazon' | 'mock_seller';

export interface SiteAdapter {
  readonly id: SiteId;
  /** True when this adapter understands the current page. Must be cheap and side-effect free. */
  detect(): boolean;
  getListing(): Listing | null;
  /** Empty array for pages without a chat (e.g. Amazon product pages). */
  getConversation(): ConversationMessage[];
  /** Fill the compose box with `text` without sending. Returns false if no compose box was found. */
  insertMessage(text: string): boolean;
  /** Fill and click a positively identified send control. Never synthesize Enter. */
  sendMessage?(text: string): boolean;
  /** Subscribe to listing/conversation changes. Returns an unsubscribe function. */
  onChange(cb: () => void): () => void;
  /**
   * Optional: which selectors matched on this page, for debugging best-effort adapters.
   * Values must be counts/booleans/short labels, never page text (it may contain personal data).
   */
  diagnose?(): Record<string, string | number | boolean>;
}
