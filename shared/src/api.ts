import { z } from 'zod';
import { Platform, Price, WishlistSource, WishlistStatus } from './domain.js';

// HTTP request bodies shared by backend (validation), extension and dashboard (typing).

const optionalUrl = z.string().url().max(2048).optional();

export const CreateWishlistItemBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(5000).optional(),
    image_url: optionalUrl,
    source: WishlistSource.default('manual'),
    source_url: optionalUrl,
    target_price: Price.optional(),
    max_price: Price.optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.target_price === undefined || b.max_price === undefined || b.target_price <= b.max_price,
    { message: 'target_price must be <= max_price', path: ['target_price'] },
  );
export type CreateWishlistItemBody = z.infer<typeof CreateWishlistItemBody>;

export const UpdateWishlistItemBody = z
  .object({
    title: z.string().trim().min(1).max(300),
    description: z.string().max(5000).nullable(),
    image_url: z.string().url().max(2048).nullable(),
    source_url: z.string().url().max(2048).nullable(),
    target_price: Price.nullable(),
    max_price: Price.nullable(),
    status: WishlistStatus,
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });
export type UpdateWishlistItemBody = z.infer<typeof UpdateWishlistItemBody>;

/** Listing facts the extension adapter read from the page. All optional; stored on the negotiation. */
export const ListingInfo = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    price: Price.optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    description: z.string().max(5000).optional(),
    attributes: z.record(z.string().max(100), z.string().max(500)).optional(),
  })
  .strict();
export type ListingInfo = z.infer<typeof ListingInfo>;

export const CreateNegotiationBody = z
  .object({
    item_id: z.number().int().positive(),
    platform: Platform,
    listing_url: optionalUrl,
    seller_label: z.string().max(200).optional(),
    listing: ListingInfo.optional(),
  })
  .strict();
export type CreateNegotiationBody = z.infer<typeof CreateNegotiationBody>;

export const DraftRequestBody = z
  .object({
    /** Optional steer from the user, e.g. "be firmer" or "ask about battery health". */
    instructions: z.string().max(500).optional(),
  })
  .strict();
export type DraftRequestBody = z.infer<typeof DraftRequestBody>;

export const SellerMessageBody = z.object({ text: z.string().trim().min(1).max(4000) }).strict();
export type SellerMessageBody = z.infer<typeof SellerMessageBody>;

/** The user approved (possibly edited) text. Recorded before the extension inserts it into the page. */
export const BuyerMessageBody = z
  .object({
    text: z.string().trim().min(1).max(4000),
    draft_message_id: z.number().int().positive().optional(),
  })
  .strict();
export type BuyerMessageBody = z.infer<typeof BuyerMessageBody>;

export const ConfirmPriceBody = z
  .object({
    agreed_price: Price.refine((n) => n > 0, 'must be > 0'),
  })
  .strict();
export type ConfirmPriceBody = z.infer<typeof ConfirmPriceBody>;

export const CreatePaymentBody = z
  .object({
    negotiation_id: z.number().int().positive(),
    amount: Price.refine((n) => n > 0, 'must be > 0'),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();
export type CreatePaymentBody = z.infer<typeof CreatePaymentBody>;

/** Machine-readable reasons a payment request is refused. */
export const PaymentRejectionCode = z.enum([
  'exceeds_max_price',
  'no_max_price',
  'amount_mismatch',
  'negotiation_not_agreed',
  'currency_mismatch',
  'already_paid',
]);
export type PaymentRejectionCode = z.infer<typeof PaymentRejectionCode>;

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
