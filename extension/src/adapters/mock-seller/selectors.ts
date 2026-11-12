/** All DOM hooks for the local mock seller page (mock-seller/index.html). */
export const MOCK_SELLER_SELECTORS = {
  siteMarker: 'body[data-fargain-site="mock_seller"]',
  title: '[data-testid="listing-title"]',
  price: '[data-testid="listing-price"]',
  condition: '[data-testid="listing-condition"]',
  location: '[data-testid="listing-location"]',
  description: '[data-testid="listing-description"]',
  seller: '[data-testid="seller-name"]',
  image: '[data-testid="listing-image"]',
  chatLog: '[data-testid="chat-log"]',
  message: '[data-testid="chat-log"] .msg[data-role]',
  messageText: '.msg-text',
  compose: '[data-testid="compose"]',
  send: '[data-testid="send"]',
} as const;
