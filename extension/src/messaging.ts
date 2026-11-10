import type { ConversationMessage, Listing, SiteId } from './adapters/types';

/** Side panel -> content script requests (chrome.tabs.sendMessage). */
export type ContentRequest =
  { type: 'fargain:getContext' } | { type: 'fargain:insert'; text: string };

export interface PageContext {
  site: SiteId | null;
  listing: Listing | null;
  conversation: ConversationMessage[];
  /** Which selectors matched (best-effort adapters only). No page text. */
  diagnostics?: Record<string, string | number | boolean>;
}

export type ContentResponse =
  | { ok: true; context: PageContext }
  | { ok: true; inserted: boolean }
  | { ok: false; error: string };

/** Content script -> extension broadcast when the page's listing or chat changes. */
export interface PageChangedEvent {
  type: 'fargain:pageChanged';
}
