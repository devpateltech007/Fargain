import type { Db } from './db/index.js';

/**
 * Single-user demo: every API call acts as the first user, created on boot if missing.
 * Instagram account linking (Phase 5) maps an IG sender ID onto this user.
 */
export function ensureDefaultUser(db: Db): number {
  const row = db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get() as
    { id: number } | undefined;
  if (row) return row.id;
  return Number(
    db.prepare("INSERT INTO users (display_name) VALUES ('Demo buyer')").run().lastInsertRowid,
  );
}
