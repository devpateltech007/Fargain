/**
 * Ordered SQL migrations. Applied in order; PRAGMA user_version records the last applied index.
 * Never edit a migration that has shipped: append a new one.
 *
 * Money columns are REAL in major units (e.g. 49.99). The API layer only accepts values with
 * at most two decimals, and all comparisons (max-price enforcement) are done in integer cents.
 */
export const migrations: string[] = [
  /* 1: base schema */ `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name  TEXT NOT NULL,
    profile_json  TEXT NOT NULL DEFAULT '{"student":false,"memberships":[]}',
    linked_ig_id  TEXT UNIQUE,
    link_code     TEXT UNIQUE,
    link_code_expires_at TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE wishlist_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT,
    image_url     TEXT,
    source        TEXT NOT NULL CHECK (source IN ('instagram','manual','amazon')),
    source_url    TEXT,
    target_price  REAL CHECK (target_price IS NULL OR target_price >= 0),
    max_price     REAL CHECK (max_price IS NULL OR max_price >= 0),
    status        TEXT NOT NULL DEFAULT 'watching'
                  CHECK (status IN ('watching','negotiating','purchased','archived')),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_wishlist_user ON wishlist_items(user_id);

  CREATE TABLE price_snapshots (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id   INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
    retailer  TEXT NOT NULL,
    price     REAL NOT NULL CHECK (price >= 0),
    url       TEXT,
    taken_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_snapshots_item ON price_snapshots(item_id, taken_at);

  CREATE TABLE negotiations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id       INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
    platform      TEXT NOT NULL,
    listing_url   TEXT,
    seller_label  TEXT,
    status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','agreed','paid','abandoned')),
    agreed_price  REAL CHECK (agreed_price IS NULL OR agreed_price >= 0),
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_negotiations_item ON negotiations(item_id);

  CREATE TABLE messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    negotiation_id    INTEGER NOT NULL REFERENCES negotiations(id) ON DELETE CASCADE,
    role              TEXT NOT NULL CHECK (role IN ('buyer_draft','buyer_sent','seller')),
    text              TEXT NOT NULL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    ai_reasoning_json TEXT
  );
  CREATE INDEX idx_messages_negotiation ON messages(negotiation_id, created_at);

  CREATE TABLE payments (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    negotiation_id   INTEGER NOT NULL REFERENCES negotiations(id),
    paypal_order_id  TEXT UNIQUE,
    amount           REAL NOT NULL CHECK (amount > 0),
    currency         TEXT NOT NULL,
    status           TEXT NOT NULL,
    idempotency_key  TEXT NOT NULL UNIQUE,
    approve_url      TEXT,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_payments_negotiation ON payments(negotiation_id);

  CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id),
    actor       TEXT NOT NULL CHECK (actor IN ('agent','user','system')),
    action      TEXT NOT NULL,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_audit_user ON audit_log(user_id, created_at);
  `,
  /* 2: listing facts + cached price assessment on negotiations */ `
  ALTER TABLE negotiations ADD COLUMN listing_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE negotiations ADD COLUMN assessment_json TEXT;
  CREATE INDEX idx_negotiations_listing ON negotiations(listing_url);
  `,
  /* 3: Channel3 product links for price watch + price-drop alerts */ `
  ALTER TABLE wishlist_items ADD COLUMN channel3_product_ids TEXT NOT NULL DEFAULT '[]';
  CREATE TABLE alerts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES wishlist_items(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('price_drop')),
    price       REAL NOT NULL CHECK (price >= 0),
    retailer    TEXT,
    url         TEXT,
    detail_json TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    seen_at     TEXT
  );
  CREATE INDEX idx_alerts_user ON alerts(user_id, created_at);
  `,
  /* 4: Reel Mode: DM conversation state + webhook de-duplication */ `
  CREATE TABLE reel_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ig_sender_id    TEXT,
    channel         TEXT NOT NULL CHECK (channel IN ('instagram_dm','dashboard')),
    status          TEXT NOT NULL CHECK (status IN ('awaiting_confirmation','awaiting_screenshot','added','failed')),
    source_url      TEXT,
    caption         TEXT,
    candidates_json TEXT NOT NULL DEFAULT '[]',
    item_id         INTEGER REFERENCES wishlist_items(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_reel_sessions_sender ON reel_sessions(ig_sender_id, status);
  CREATE TABLE processed_webhook_messages (
    mid         TEXT PRIMARY KEY,
    received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
  /* 5: keep a buyer's budget from a Reel DM until product confirmation */ `
  ALTER TABLE reel_sessions ADD COLUMN buyer_max_price REAL CHECK (buyer_max_price IS NULL OR buyer_max_price >= 0);
  `,
];
