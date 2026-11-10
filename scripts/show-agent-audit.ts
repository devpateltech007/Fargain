/** Print agent assessments and drafts for the given negotiation ids: tsx scripts/show-agent-audit.ts 7 8 */
import Database from 'better-sqlite3';
import { getConfig, resolveDatabasePath } from '../backend/src/config.js';

const ids = process.argv.slice(2).map(Number);
const db = new Database(resolveDatabasePath(getConfig()), { readonly: true });
const rows = db
  .prepare("SELECT action, detail_json FROM audit_log WHERE action LIKE 'agent.%' ORDER BY id")
  .all() as { action: string; detail_json: string }[];
for (const r of rows) {
  const d = JSON.parse(r.detail_json) as { negotiation_id?: number };
  if (ids.length && !ids.includes(d.negotiation_id ?? -1)) continue;
  console.log(r.action, JSON.stringify(d));
}
