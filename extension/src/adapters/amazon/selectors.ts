/**
 * Amazon product page selectors (amazon.com). These IDs have been stable on Amazon for years, but
 * are still best effort and UNVERIFIED by a live check in this repo. Edit only this file if
 * Amazon changes its markup; the side panel "Page check" shows which entries matched.
 */
export const AMAZON = {
  hosts: ['www.amazon.com', 'smile.amazon.com', 'amazon.com'],
  /** /dp/<ASIN>, /gp/product/<ASIN>, /<slug>/dp/<ASIN> */
  asinPath: /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/,
  asinInput: ['input#ASIN', 'input[name="ASIN"]'],
  title: ['#productTitle', '#title'],
  /** Brand line, e.g. "Visit the Sony Store" or "Brand: Sony". */
  brand: ['#bylineInfo', '#brand'],
  /** Visible price; `.a-offscreen` holds the full "$348.00" text. */
  price: [
    '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '#apex_desktop .a-price .a-offscreen',
    '#priceblock_ourprice',
    '#priceblock_dealprice',
    '#centerCol .a-price .a-offscreen',
  ],
  image: ['#landingImage', '#imgTagWrapperId img'],
  /** Re-read when this region changes (variant/color selection updates the price). */
  changeRoot: ['#centerCol', '#dp-container', 'body'],
} as const;
