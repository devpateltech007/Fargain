// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalItemUrl, createMarketplaceAdapter } from './adapter';

// Fixtures are SYNTHETIC (see the comment at the top of each file), not real Facebook captures.
const fixture = (name: string) =>
  readFileSync(
    path.join(process.cwd(), 'extension/src/adapters/marketplace/fixtures', name),
    'utf8',
  );

function load(url: string, html: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  document.body.innerHTML = html;
}

describe('canonicalItemUrl', () => {
  it('normalizes item URLs and rejects others', () => {
    expect(canonicalItemUrl('/marketplace/item/123456/?ref=search&tracking=x')).toBe(
      'https://www.facebook.com/marketplace/item/123456/',
    );
    expect(canonicalItemUrl('https://web.facebook.com/marketplace/item/987/')).toBe(
      'https://www.facebook.com/marketplace/item/987/',
    );
    expect(
      canonicalItemUrl('https://www.facebook.com/marketplace/category/electronics'),
    ).toBeNull();
  });
});

describe('MarketplaceAdapter on an item page with the chat popup', () => {
  beforeEach(() =>
    load(
      'https://www.facebook.com/marketplace/item/1234567890123456/?ref=browse',
      fixture('item-page.html'),
    ),
  );

  it('detects the page', () => {
    expect(createMarketplaceAdapter(document).detect()).toBe(true);
  });

  it('reads the listing', () => {
    expect(createMarketplaceAdapter(document).getListing()).toMatchObject({
      title: 'Sony WH-1000XM5 Noise Cancelling Headphones',
      url: 'https://www.facebook.com/marketplace/item/1234567890123456/',
      price: 180,
      currency: 'USD',
      sellerLabel: 'Jordan M.',
      imageUrl: 'https://scontent.example/p1.jpg',
      description: 'Barely used, comes with case and cables. Pickup only.',
      attributes: { condition: 'Used - Like New' },
    });
  });

  it('reads the conversation and tells buyer from seller', () => {
    expect(createMarketplaceAdapter(document).getConversation()).toEqual([
      { role: 'buyer', text: 'Hi, is this still available?' },
      { role: 'seller', text: 'Yes! Asking $180.' },
    ]);
  });

  it('fills the Lexical textbox and never sends', () => {
    let submitted = false;
    let clicked = false;
    let keyed = false;
    document.querySelector('form')!.addEventListener('submit', () => (submitted = true));
    document
      .querySelector('[aria-label="Press enter to send"]')!
      .addEventListener('click', () => (clicked = true));
    const box = document.querySelector<HTMLElement>('[role="textbox"]')!;
    box.addEventListener('keydown', () => (keyed = true));

    expect(createMarketplaceAdapter(document).insertMessage('Would you take $130?')).toBe(true);
    expect(box.textContent).toBe('Would you take $130?');
    expect(submitted || clicked || keyed).toBe(false);
    expect(document.querySelectorAll('[role="row"]')).toHaveLength(3);
  });

  it('reports diagnostics without page text', () => {
    const d = createMarketplaceAdapter(document).diagnose!();
    expect(d).toMatchObject({
      on_facebook: true,
      page: 'item',
      price_found: true,
      seller_found: true,
      chat_rows: 2,
    });
    expect(d.compose_box).not.toBe('none');
    expect(JSON.stringify(d)).not.toContain('Asking');
  });
});

describe('MarketplaceAdapter on a Messenger thread', () => {
  beforeEach(() =>
    load('https://www.facebook.com/messages/t/555000111/', fixture('thread-page.html')),
  );

  it('maps the thread to the same canonical listing URL as the item page', () => {
    expect(createMarketplaceAdapter(document).getListing()).toMatchObject({
      title: 'Sony WH-1000XM5 Noise Cancelling Headphones',
      url: 'https://www.facebook.com/marketplace/item/1234567890123456/',
      price: 180,
    });
  });

  it('reads the conversation', () => {
    expect(
      createMarketplaceAdapter(document)
        .getConversation()
        .map((m) => m.role),
    ).toEqual(['buyer', 'seller']);
  });
});

describe('MarketplaceAdapter stays inert elsewhere', () => {
  afterEach(() => vi.useRealTimers());

  it('does not detect the Facebook feed or other sites', () => {
    load('https://www.facebook.com/', '<div role="main"><h1>Feed</h1></div>');
    expect(createMarketplaceAdapter(document).detect()).toBe(false);
    load('https://www.example.com/marketplace/item/123/', fixture('item-page.html'));
    expect(createMarketplaceAdapter(document).detect()).toBe(false);
    expect(createMarketplaceAdapter(document).onChange(() => undefined)).toBeTypeOf('function');
  });

  it('notifies on SPA navigation into a listing', () => {
    vi.useFakeTimers();
    load('https://www.facebook.com/marketplace/', '<div role="main"></div>');
    const cb = vi.fn();
    const stop = createMarketplaceAdapter(document).onChange(cb);
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
      'https://www.facebook.com/marketplace/item/42/',
    );
    vi.advanceTimersByTime(1100);
    expect(cb).toHaveBeenCalled();
    stop();
  });
});
