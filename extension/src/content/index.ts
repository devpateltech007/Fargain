import { createMarketplaceAdapter } from '../adapters/marketplace/adapter';
import { createMockSellerAdapter } from '../adapters/mock-seller/adapter';
import type { SiteAdapter } from '../adapters/types';
import type { ContentRequest, ContentResponse, PageChangedEvent } from '../messaging';

// Adapter registry. The Amazon adapter is added in Phase 4.
const adapters: SiteAdapter[] = [createMockSellerAdapter(), createMarketplaceAdapter()];

/** Re-evaluated on every request: SPAs (Facebook) change pages without reloading the script. */
const active = (): SiteAdapter | null => adapters.find((a) => a.detect()) ?? null;

const notify = () => {
  const evt: PageChangedEvent = { type: 'fargain:pageChanged' };
  // The side panel may be closed; ignore "no receiver" errors.
  chrome.runtime.sendMessage(evt).catch(() => undefined);
};
for (const a of adapters) a.onChange(notify);

chrome.runtime.onMessage.addListener(
  (msg: ContentRequest, _sender, sendResponse: (r: ContentResponse) => void) => {
    try {
      const a = active();
      if (msg.type === 'fargain:getContext') {
        sendResponse({
          ok: true,
          context: a
            ? {
                site: a.id,
                listing: a.getListing(),
                conversation: a.getConversation(),
                diagnostics: a.diagnose?.(),
              }
            : { site: null, listing: null, conversation: [] },
        });
      } else if (msg.type === 'fargain:insert') {
        // Only fills the compose box. The user reviews and clicks send.
        sendResponse({ ok: true, inserted: a ? a.insertMessage(msg.text) : false });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  },
);
