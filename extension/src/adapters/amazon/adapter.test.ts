// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { asinOf, createAmazonAdapter } from './adapter';

// SYNTHETIC markup using Amazon's long-standing element IDs. Not captured from amazon.com.
const PRODUCT = `
  <div id="dp-container"><div id="centerCol">
    <span id="productTitle">   Sony WH-1000XM5 The Best Wireless Noise Canceling Headphones with Auto Noise Canceling Optimizer, Black   </span>
    <a id="bylineInfo" href="/stores/Sony">Visit the Sony Store</a>
    <div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">$328.00</span><span aria-hidden="true">$328<sup>00</sup></span></span></div>
  </div>
  <div id="imgTagWrapperId"><img id="landingImage" src="https://m.media-amazon.com/images/I/xm5.jpg" /></div>
  <input type="hidden" id="ASIN" value="B09XS7JWHH" /></div>`;

function load(url: string, html: string) {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  document.body.innerHTML = html;
}

describe('AmazonAdapter', () => {
  it('reads title, price, brand, image and a canonical ASIN URL', () => {
    load(
      'https://www.amazon.com/Sony-WH-1000XM5-Canceling-Headphones/dp/B09XS7JWHH/ref=sr_1_1?keywords=xm5',
      PRODUCT,
    );
    const a = createAmazonAdapter(document);
    expect(a.detect()).toBe(true);
    expect(a.getListing()).toMatchObject({
      title:
        'Sony WH-1000XM5 The Best Wireless Noise Canceling Headphones with Auto Noise Canceling Optimizer, Black',
      url: 'https://www.amazon.com/dp/B09XS7JWHH',
      price: 328,
      currency: 'USD',
      imageUrl: 'https://m.media-amazon.com/images/I/xm5.jpg',
      attributes: { asin: 'B09XS7JWHH', brand: 'Visit the Sony Store' },
    });
    expect(a.diagnose!()).toMatchObject({ asin_found: true, price_found: true, brand_found: true });
  });

  it('is read-only: no conversation, never inserts text', () => {
    load('https://www.amazon.com/dp/B09XS7JWHH', PRODUCT);
    const a = createAmazonAdapter(document);
    expect(a.getConversation()).toEqual([]);
    expect(a.insertMessage('anything')).toBe(false);
  });

  it('falls back to the hidden ASIN input and ignores non-product pages', () => {
    load('https://www.amazon.com/some/odd/path', PRODUCT);
    expect(asinOf(document)).toBe('B09XS7JWHH');
    load('https://www.amazon.com/s?k=headphones', '<div id="search">results</div>');
    expect(createAmazonAdapter(document).detect()).toBe(false);
    load('https://www.example.com/dp/B09XS7JWHH', PRODUCT);
    expect(createAmazonAdapter(document).detect()).toBe(false);
  });
});
