import type { UserProfile } from '@fargain/shared';

/**
 * Applies ONLY discounts the user entered in their profile. Nothing is invented or scraped.
 * Percent discounts stack multiplicatively in the order entered (10% then 5% = 14.5% off), which
 * is the conservative assumption; retailers may not allow stacking, so the UI labels it "up to".
 */
export interface AppliedDiscount {
  label: string;
  percent: number;
  savings: number;
}

export interface DiscountResult {
  base_price: number;
  final_price: number;
  applied: AppliedDiscount[];
  /** Profile discounts that exist but don't apply here, with why. */
  skipped: { label: string; reason: string }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function domainMatches(discountDomains: string[], domain: string): boolean {
  if (!discountDomains.length) return true;
  const d = domain.toLowerCase().replace(/^www\./, '');
  return discountDomains.some(
    (x) => d === x.replace(/^www\./, '') || d.endsWith(`.${x.replace(/^www\./, '')}`),
  );
}

export function applyProfileDiscounts(
  price: number,
  domain: string,
  profile: UserProfile,
  today: Date = new Date(),
): DiscountResult {
  let current = price;
  const applied: AppliedDiscount[] = [];
  const skipped: DiscountResult['skipped'] = [];
  const birthdayMonth = profile.birthday ? Number(profile.birthday.slice(5, 7)) : null;

  for (const d of profile.discounts) {
    if (!domainMatches(d.domains, domain)) {
      skipped.push({ label: d.label, reason: `only at ${d.domains.join(', ')}` });
      continue;
    }
    if (d.requires === 'student' && !profile.student) {
      skipped.push({ label: d.label, reason: 'requires student status' });
      continue;
    }
    if (d.requires === 'birthday_month' && birthdayMonth !== today.getUTCMonth() + 1) {
      skipped.push({
        label: d.label,
        reason: birthdayMonth ? 'only in your birthday month' : 'add your birthday to use it',
      });
      continue;
    }
    const savings = round2(current * (d.percent / 100));
    current = round2(current - savings);
    applied.push({ label: d.label, percent: d.percent, savings });
  }
  return { base_price: price, final_price: current, applied, skipped };
}
