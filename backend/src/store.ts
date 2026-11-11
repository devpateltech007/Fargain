import type {
  MessageRole,
  NegotiationStatus,
  WishlistSource,
  WishlistStatus,
} from '@fargain/shared';
import type { Db } from './db/index.js';

// Row types mirror the SQLite schema (backend/src/db/migrations.ts).

export interface WishlistItemRow {
  id: number;
  user_id: number;
  title: string;
  description: string | null;
  image_url: string | null;
  source: WishlistSource;
  source_url: string | null;
  target_price: number | null;
  max_price: number | null;
  status: WishlistStatus;
  /** JSON array of Channel3 product ids matched to this item (used by the price watch). */
  channel3_product_ids: string;
  created_at: string;
  updated_at: string;
}

export interface NegotiationRow {
  id: number;
  item_id: number;
  platform: string;
  listing_url: string | null;
  seller_label: string | null;
  status: NegotiationStatus;
  agreed_price: number | null;
  listing_json: string;
  assessment_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  negotiation_id: number;
  role: MessageRole;
  text: string;
  created_at: string;
  ai_reasoning_json: string | null;
}

export interface PaymentRow {
  id: number;
  negotiation_id: number;
  paypal_order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  idempotency_key: string;
  approve_url: string | null;
  created_at: string;
  updated_at: string;
}

export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export function getItem(db: Db, userId: number, id: number): WishlistItemRow | undefined {
  return db.prepare('SELECT * FROM wishlist_items WHERE id = ? AND user_id = ?').get(id, userId) as
    WishlistItemRow | undefined;
}

/** Negotiation joined with its item, scoped to the user. */
export function getNegotiation(
  db: Db,
  userId: number,
  id: number,
): { negotiation: NegotiationRow; item: WishlistItemRow } | undefined {
  const negotiation = db
    .prepare(
      `SELECT n.* FROM negotiations n JOIN wishlist_items i ON i.id = n.item_id
       WHERE n.id = ? AND i.user_id = ?`,
    )
    .get(id, userId) as NegotiationRow | undefined;
  if (!negotiation) return undefined;
  const item = getItem(db, userId, negotiation.item_id)!;
  return { negotiation, item };
}

export function getPayment(db: Db, userId: number, id: number): PaymentRow | undefined {
  return db
    .prepare(
      `SELECT p.* FROM payments p
       JOIN negotiations n ON n.id = p.negotiation_id
       JOIN wishlist_items i ON i.id = n.item_id
       WHERE p.id = ? AND i.user_id = ?`,
    )
    .get(id, userId) as PaymentRow | undefined;
}

export function getPaymentByOrderId(db: Db, orderId: string): PaymentRow | undefined {
  return db.prepare('SELECT * FROM payments WHERE paypal_order_id = ?').get(orderId) as
    PaymentRow | undefined;
}

export function listMessages(db: Db, negotiationId: number): MessageRow[] {
  return db
    .prepare('SELECT * FROM messages WHERE negotiation_id = ? ORDER BY id')
    .all(negotiationId) as MessageRow[];
}

export function insertMessage(
  db: Db,
  negotiationId: number,
  role: MessageRole,
  text: string,
  reasoning?: unknown,
): MessageRow {
  const id = Number(
    db
      .prepare(
        'INSERT INTO messages (negotiation_id, role, text, ai_reasoning_json) VALUES (?, ?, ?, ?)',
      )
      .run(negotiationId, role, text, reasoning === undefined ? null : JSON.stringify(reasoning))
      .lastInsertRowid,
  );
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow;
}
