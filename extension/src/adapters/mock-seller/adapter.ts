import { fillComposeBox, observe, parsePrice, text } from '../dom';
import type { ConversationMessage, Listing, SiteAdapter } from '../types';
import { MOCK_SELLER_SELECTORS as S } from './selectors';

export function createMockSellerAdapter(doc: Document = document): SiteAdapter {
  return {
    id: 'mock_seller',
    detect: () => doc.querySelector(S.siteMarker) !== null,

    getListing(): Listing | null {
      const title = text(doc, S.title);
      if (!title) return null;
      const attributes: Record<string, string> = {};
      const condition = text(doc, S.condition);
      const location = text(doc, S.location);
      if (condition) attributes.condition = condition;
      if (location) attributes.location = location;
      const img = doc.querySelector<HTMLImageElement>(S.image);
      return {
        title,
        url: doc.location.href,
        price: parsePrice(text(doc, S.price)),
        currency: 'USD',
        sellerLabel: text(doc, S.seller),
        imageUrl: img?.src || undefined,
        description: text(doc, S.description),
        attributes,
      };
    },

    getConversation(): ConversationMessage[] {
      return [...doc.querySelectorAll<HTMLElement>(S.message)].map((el) => ({
        role: el.dataset.role === 'seller' ? 'seller' : 'buyer',
        text: text(el, S.messageText) ?? '',
        timestamp: el.dataset.at,
      }));
    },

    insertMessage(value: string): boolean {
      const box = doc.querySelector(S.compose);
      return box ? fillComposeBox(box, value) : false;
    },

    sendMessage(value: string): boolean {
      const box = doc.querySelector<HTMLTextAreaElement>(S.compose);
      const button = doc.querySelector<HTMLButtonElement>(S.send);
      if (!box || !button || button.disabled) return false;
      if (box.value.trim() !== value.trim()) fillComposeBox(box, value);
      if (box.value.trim() !== value.trim()) return false;
      button.click();
      return true;
    },

    onChange(cb) {
      const log = doc.querySelector(S.chatLog);
      return observe(log ?? doc.body, cb);
    },
  };
}
