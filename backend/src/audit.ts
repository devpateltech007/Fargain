import type { AuditActor } from '@fargain/shared';
import type { Db } from './db/index.js';

export interface AuditEntry {
  userId: number | null;
  actor: AuditActor;
  action: string;
  detail?: Record<string, unknown>;
}

/** Append-only audit trail. Never put secrets or full tokens in `detail`. */
export function audit(db: Db, e: AuditEntry): void {
  db.prepare('INSERT INTO audit_log (user_id, actor, action, detail_json) VALUES (?, ?, ?, ?)').run(
    e.userId,
    e.actor,
    e.action,
    JSON.stringify(e.detail ?? {}),
  );
}
