import type { Channel3Product } from './channel3.js';

/**
 * Trimmed copies of REAL Channel3 /v1/search results recorded with scripts/probe-channel3.ts
 * (Nov 2026). Only fields we read are kept. Offer URLs are shortened placeholders.
 */
const offer = (domain: string, price: number, compare: number | null = null) => ({
  url: `https://buy.trychannel3.com/x-${domain}`,
  domain,
  price: { price, compare_at_price: compare, currency: 'USD' },
  availability: 'InStock',
  condition: 'new',
});
const p = (
  id: string,
  title: string,
  brand: string,
  offers: ReturnType<typeof offer>[],
  slug = 'headphones',
): Channel3Product =>
  ({
    id,
    title,
    brands: [{ id: 'b', name: brand }],
    images: [{ url: `https://cdn.example/${id}.jpg`, is_main_image: true }],
    category: { slug, title: slug },
    offers,
  }) as Channel3Product;

export const XM5_RESULTS: Channel3Product[] = [
  p('hrz4MAW', 'WH-1000XM5 Over-Ear Noise Cancelling Bluetooth Headphones', 'Sony', [
    offer('6ave.com', 398),
  ]),
  p('UAwR9e0', 'SONY WH-1000XM5 noise-cancelling headphones', 'Sony', [
    offer('selfridges.com', 340),
  ]),
  p('3GYVjuP', 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', 'Sony', [
    offer('hsn.com', 399.99),
  ]),
  p('aggqNMU', 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', 'Sony', [
    offer('bhphotovideo.com', 298, 398),
    offer('crutchfield.ca', 298, 398),
  ]),
  p('auFtLqU', 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', 'Sony', [
    offer('beachcamera.com', 319.99, 492.92),
  ]),
];

export const AF1_RESULTS: Channel3Product[] = [
  p('yZYfwdR', "Air Force 1 '07", 'Nike', [offer('dtlr.com', 10, 115)], 'sneakers'),
  p(
    'IFOtvpD',
    "Nike Air Force 1 '07 Sneakers",
    'Nike',
    [
      offer('kickscrew.com', 58.5),
      offer('nike.com', 110.97),
      offer('feature.com', 115),
      offer('footlocker.ca', 115),
    ],
    'sneakers',
  ),
  p(
    '0g1jxGX',
    "Nike Air Force 1 '07 Shoe - Men's",
    'Nike',
    [offer('selfridges.com', 107, 133), offer('kith.com', 115)],
    'sneakers',
  ),
  p('LIYRMop', "Nike Air Force 1 '07 sneakers", 'Nike', [offer('farfetch.com', 123)], 'sneakers'),
];

export const AIRPODS_RESULTS: Channel3Product[] = [
  p('OMBs5vc', 'Apple AirPods Pro 2 with Active Noise Cancellation & Hearing Health', 'Apple', [
    offer('hsn.com', 309.99),
  ]),
  p('RWvTn6A', 'AirPods Pro 2 Magsafe Active Noise Cancelling True Wireless Bluetooth ', 'Apple', [
    offer('bestbuy.com', 249.95),
  ]),
  p('qvAURc6', 'Apple AirPods Pro', 'Apple', [offer('6ave.com', 258.49)]),
  p('iQE8oC9', 'AirPods Max 2 Over-Ear Headphones with H2 Chip', 'Apple', [
    offer('samsclub.com', 549),
    offer('hsn.com', 769.99),
  ]),
];
