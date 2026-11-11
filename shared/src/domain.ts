import { z } from 'zod';

// Enumerations shared by the backend (SQLite CHECK constraints), extension, and dashboard.

export const WishlistSource = z.enum(['instagram', 'manual', 'amazon']);
export type WishlistSource = z.infer<typeof WishlistSource>;

export const WishlistStatus = z.enum(['watching', 'negotiating', 'purchased', 'archived']);
export type WishlistStatus = z.infer<typeof WishlistStatus>;

export const MessageRole = z.enum(['buyer_draft', 'buyer_sent', 'seller']);
export type MessageRole = z.infer<typeof MessageRole>;

export const NegotiationStatus = z.enum(['open', 'agreed', 'paid', 'abandoned']);
export type NegotiationStatus = z.infer<typeof NegotiationStatus>;

export const Platform = z.enum(['facebook_marketplace', 'mock_seller', 'amazon', 'instagram']);
export type Platform = z.infer<typeof Platform>;

export const AuditActor = z.enum(['agent', 'user', 'system']);
export type AuditActor = z.infer<typeof AuditActor>;

export const UserProfile = z.object({
  student: z.boolean().default(false),
  birthday: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'birthday must be YYYY-MM-DD')
    .optional(),
  memberships: z.array(z.string().min(1)).default([]),
  /**
   * Discounts the user knows they have, entered manually (no retailer logins, no email scanning).
   * Fargain never invents discount rates; only these are stacked onto prices.
   */
  discounts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(60),
        percent: z.number().gt(0).max(90),
        /** Retailer domains this applies to (e.g. "amazon.com"); empty = any retailer. */
        domains: z.array(z.string().trim().toLowerCase().min(3).max(100)).max(20).default([]),
        requires: z.enum(['none', 'student', 'birthday_month']).default('none'),
      }),
    )
    .max(20)
    .default([]),
});
export type UserProfile = z.infer<typeof UserProfile>;

/**
 * A price in major currency units (e.g. 49.99). At most two decimal places are accepted so
 * that server-side comparisons can be done exactly in integer cents.
 */
export const Price = z
  .number()
  .finite()
  .nonnegative()
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, 'at most 2 decimal places');

/** Convert a major-unit price to integer cents for exact comparison. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}
