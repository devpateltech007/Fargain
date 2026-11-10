import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module served to the browser as-is
import { createSellerBot, lastAmount } from './seller-bot.js';

describe('scripted seller bot', () => {
  it('is deterministic: same buyer turns give the same replies', () => {
    const turns = ['Hi, is this available?', 'Would you take $130?', 'How about $145?'];
    const a = createSellerBot();
    const b = createSellerBot();
    expect(turns.map((t) => a.reply(t))).toEqual(turns.map((t) => b.reply(t)));
  });

  it('standard scenario: counters, then accepts at or above the floor', () => {
    const bot = createSellerBot({ scenario: 'standard' });
    expect(bot.reply('Hi! Is this still available?')).toMatch(/Asking \$180/);
    expect(bot.reply('Would you take $120?')).toMatch(/Could you do \$150\?/);
    expect(bot.reply('How about $145?')).toMatch(/deal at \$145/i);
    expect(bot.state().agreedAt).toBe(145);
  });

  it('scam scenario pushes deposits, Zelle and texting', () => {
    const bot = createSellerBot({ scenario: 'scam' });
    expect(bot.reply('Hi')).toMatch(/deposit/);
    expect(bot.reply('Would you take $120?')).toMatch(/pay first/);
    expect(bot.reply('$145?')).toMatch(/Zelle/);
  });

  it('lastAmount ignores model numbers', () => {
    expect(lastAmount('Is the WH-1000XM5 ok? Would you take $130?')).toBe(130);
    expect(lastAmount('Is the WH-1000XM5 ok?')).toBeNull();
  });
});
