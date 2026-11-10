import { createMockSellerAdapter } from '../adapters/mock-seller/adapter';
import type { SiteAdapter } from '../adapters/types';
import type { ContentRequest, ContentResponse, PageChangedEvent } from '../messaging';

// Adapter registry. Marketplace and Amazon adapters are added in Phases 3 and 4.
const adapters: SiteAdapter[] = [createMockSellerAdapter()];
const active = adapters.find((a) => a.detect()) ?? null;

if (active) {
  console.info(`[fargain] adapter active: ${active.id}`);
  active.onChange(() => {
    const evt: PageChangedEvent = { type: 'fargain:pageChanged' };
    // The side panel may be closed; ignore "no receiver" errors.
    chrome.runtime.sendMessage(evt).catch(() => undefined);
  });
}

chrome.runtime.onMessage.addListener(
  (msg: ContentRequest, _sender, sendResponse: (r: ContentResponse) => void) => {
    try {
      if (msg.type === 'fargain:getContext') {
        sendResponse({
          ok: true,
          context: active
            ? {
                site: active.id,
                listing: active.getListing(),
                conversation: active.getConversation(),
              }
            : { site: null, listing: null, conversation: [] },
        });
      } else if (msg.type === 'fargain:insert') {
        // Only fills the compose box. The user reviews and clicks send.
        sendResponse({ ok: true, inserted: active ? active.insertMessage(msg.text) : false });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
    return false;
  },
);
