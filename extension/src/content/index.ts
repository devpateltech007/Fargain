import { createAmazonAdapter } from '../adapters/amazon/adapter';
import { createMarketplaceAdapter } from '../adapters/marketplace/adapter';
import { createMockSellerAdapter } from '../adapters/mock-seller/adapter';
import type { SiteAdapter } from '../adapters/types';
import type { ContentRequest, ContentResponse, PageChangedEvent } from '../messaging';

// Adapter registry. Each adapter's detect() checks its own host, so only one can be active.
const adapters: SiteAdapter[] = [
  createMockSellerAdapter(),
  createMarketplaceAdapter(),
  createAmazonAdapter(),
];

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
        sendResponse({ ok: true, inserted: a ? a.insertMessage(msg.text) : false });
      } else if (msg.type === 'fargain:send') {
        // Called only by the explicit bounded-autopilot action in the side panel.
        sendResponse({ ok: true, sent: a?.sendMessage?.(msg.text) ?? false });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  },
);
