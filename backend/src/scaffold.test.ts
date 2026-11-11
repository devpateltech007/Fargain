import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startTestApp } from './test-utils.js';
import { MissingConfigError, loadDotEnv, missingFor, parseEnv, requireFeature } from './config.js';
import { openDatabase } from './db/index.js';
import { migrations } from './db/migrations.js';

describe('config', () => {
  it('applies defaults and treats empty strings as unset', () => {
    const env = parseEnv({ PAYPAL_CLIENT_ID: '', PORT: '4000' });
    expect(env.PORT).toBe(4000);
    expect(env.PAYPAL_ENV).toBe('sandbox');
    expect(env.PAYPAL_CLIENT_ID).toBeUndefined();
    expect(env.DEV_ROUTES_ENABLED).toBe(false);
    expect(env.HOST).toBe('127.0.0.1');
  });

  it('refuses any PayPal environment other than sandbox', () => {
    expect(() => parseEnv({ PAYPAL_ENV: 'live' })).toThrow(/PAYPAL_ENV/);
  });

  it('error messages never include secret values', () => {
    let message = '';
    try {
      parseEnv({ PAYPAL_ENV: 'super-secret-value' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/PAYPAL_ENV/);
    expect(message).not.toContain('super-secret-value');
  });

  it('reports missing env vars per feature', () => {
    const env = parseEnv({ PAYPAL_CLIENT_ID: 'x' });
    expect(missingFor(env, 'paypal')).toEqual(['PAYPAL_CLIENT_SECRET']);
    expect(() => requireFeature(env, 'paypal')).toThrow(MissingConfigError);
  });

  it('loadDotEnv does not override variables already in the environment', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'fargain-'));
    const file = path.join(dir, '.env');
    writeFileSync(file, 'FARGAIN_TEST_A=from_file\nFARGAIN_TEST_B=from_file\n');
    process.env.FARGAIN_TEST_A = 'from_process';
    expect(loadDotEnv(file)).toBe(true);
    expect(process.env.FARGAIN_TEST_A).toBe('from_process');
    expect(process.env.FARGAIN_TEST_B).toBe('from_file');
    expect(loadDotEnv(path.join(dir, 'missing.env'))).toBe(false);
  });
});

describe('database', () => {
  it('applies all migrations and creates every table', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('user_version', { simple: true })).toBe(migrations.length);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual([
      'alerts',
      'audit_log',
      'messages',
      'negotiations',
      'payments',
      'price_snapshots',
      'processed_webhook_messages',
      'reel_sessions',
      'users',
      'wishlist_items',
    ]);
  });

  it('enforces enum CHECK constraints and foreign keys', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO users (display_name) VALUES ('demo')").run();
    expect(() =>
      db
        .prepare("INSERT INTO wishlist_items (user_id, title, source) VALUES (1, 'x', 'ebay')")
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare("INSERT INTO wishlist_items (user_id, title, source) VALUES (99, 'x', 'manual')")
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('app', () => {
  it('accepts an empty JSON body and rejects malformed JSON with 400', async () => {
    const t = await startTestApp();
    try {
      const h = {
        Authorization: 'Bearer test-token-0123456789',
        'Content-Type': 'application/json',
      };
      const empty = await t.request('/api/negotiations/1/draft', {
        method: 'POST',
        headers: h,
        body: '',
      });
      expect(empty.status).toBe(404); // reached the route (no such negotiation), not a parse error
      const bad = await t.request('/api/wishlist', { method: 'POST', headers: h, body: '{oops' });
      expect(bad.status).toBe(400);
    } finally {
      await t.close();
    }
  });

  it('serves /api/health', async () => {
    const t = await startTestApp();
    try {
      const res = await t.request('/api/health');
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        ok: true,
        paypal_env: 'sandbox',
        db: migrations.length,
      });
    } finally {
      await t.close();
    }
  });
});
