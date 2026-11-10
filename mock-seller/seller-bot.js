// @ts-check
/**
 * Deterministic scripted seller for repeatable demos. Pure logic, no DOM, so it is unit-tested
 * (seller-bot.test.ts) and reused by the page (app.js).
 *
 * Scenarios:
 *  - "standard": friendly seller, probes the budget once, counters, accepts at or above the floor.
 *  - "scam":     same haggling, but pushes Zelle + moving to text, and asks for a deposit.
 */

export const LISTING = {
  title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones - Black',
  price: 180,
  currency: 'USD',
  seller: 'Jordan M.',
  condition: 'Used - Like New',
  location: 'Brooklyn, NY',
  description:
    'Bought in March, barely used. Comes with the case, USB-C cable and audio cable. Battery life is great, no scratches. Pickup in Brooklyn or I can meet nearby.',
  image: 'headphones.svg',
};

/** @param {string} text */
export function lastAmount(text) {
  // Digits only (no leading "$" or space in the match) so the "previous char" check looks at the
  // character right before the number: "WH-1000XM5" is skipped, "take 130.00 USD" is not.
  const matches = [...text.matchAll(/(\d{2,4})(?:\.\d{1,2})?(?![\w-])/g)].filter(
    (m) => !/[\w.,-]/.test(text[(m.index ?? 0) - 1] ?? ''),
  );
  const last = matches.at(-1);
  return last ? Number(last[1]) : null;
}

const roundTo5 = (/** @type {number} */ n) => Math.round(n / 5) * 5;

/**
 * @param {{ scenario?: 'standard' | 'scam', ask?: number, floor?: number }} [opts]
 */
export function createSellerBot(opts = {}) {
  const scenario = opts.scenario ?? 'standard';
  const ask = opts.ask ?? LISTING.price;
  const floor = opts.floor ?? 140;
  let turn = 0;
  let counter = ask;
  let agreedAt = /** @type {number | null} */ (null);

  /** @param {string} buyerText @returns {string} */
  function reply(buyerText) {
    turn++;
    if (agreedAt !== null) {
      return scenario === 'scam'
        ? `Great. Send the $${agreedAt} by Zelle to my number 555-201-3344 and I'll hold them for you.`
        : `Sounds good! See you at pickup. PayPal is fine, I'll send you my PayPal email here.`;
    }

    const offer = lastAmount(buyerText);
    if (offer === null) {
      if (turn === 1) {
        return scenario === 'scam'
          ? `Hi! Yes still available. $${ask}. Lots of people asking, so I need a deposit to hold them. What's your budget?`
          : `Hi! Yes, still available. Asking $${ask}. What were you thinking price-wise?`;
      }
      return `They're in great shape. Make me an offer.`;
    }

    if (offer >= counter || offer >= floor) {
      agreedAt = Math.min(offer, counter);
      return scenario === 'scam'
        ? `Ok deal at $${agreedAt}. Can you pay with Zelle or Cash App instead? Text me at 555-201-3344, I don't check this app much.`
        : `Ok, deal at $${agreedAt}. When can you pick up?`;
    }

    const next = Math.max(floor, roundTo5((counter + offer) / 2));
    counter = next > offer ? next : offer + 5;
    if (scenario === 'scam' && turn === 2) {
      return `I can't do $${offer}. $${counter} and they're yours, but someone else is coming today so you'd need to pay first.`;
    }
    return turn >= 4
      ? `Lowest I'll go is $${counter}.`
      : `Hmm, $${offer} is a bit low. Could you do $${counter}?`;
  }

  return { reply, state: () => ({ turn, counter, agreedAt, scenario, ask, floor }) };
}
