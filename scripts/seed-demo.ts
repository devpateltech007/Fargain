import { getConfig, resolveDatabasePath } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/index.js';
import { ensureDefaultUser } from '../backend/src/users.js';

const env = getConfig();
if (env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed demo data when NODE_ENV=production');
}
const db = openDatabase(resolveDatabasePath(env));
const userId = ensureDefaultUser(db);

function item(input: {
  title: string;
  source: 'amazon' | 'manual' | 'instagram';
  sourceUrl: string;
  target: number;
  max: number;
  status?: 'watching' | 'negotiating' | 'purchased' | 'archived';
}) {
  const found = db
    .prepare('SELECT id FROM wishlist_items WHERE user_id=? AND title=?')
    .get(userId, input.title) as { id: number } | undefined;
  if (found) return { id: found.id, created: false };
  const id = Number(
    db
      .prepare(
        `INSERT INTO wishlist_items (user_id,title,source,source_url,target_price,max_price,status)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(
        userId,
        input.title,
        input.source,
        input.sourceUrl,
        input.target,
        input.max,
        input.status ?? 'watching',
      ).lastInsertRowid,
  );
  return { id, created: true };
}

function snapshot(itemId: number, retailer: string, price: number, url: string) {
  const exists = db
    .prepare('SELECT 1 FROM price_snapshots WHERE item_id=? AND retailer=? AND price=? LIMIT 1')
    .get(itemId, retailer, price);
  if (!exists)
    db.prepare('INSERT INTO price_snapshots (item_id,retailer,price,url) VALUES (?,?,?,?)').run(
      itemId,
      retailer,
      price,
      url,
    );
}

const seed = db.transaction(() => {
  const currentProfile = db.prepare('SELECT profile_json FROM users WHERE id=?').get(userId) as {
    profile_json: string;
  };
  const profile = JSON.parse(currentProfile.profile_json) as {
    student?: boolean;
    memberships?: string[];
    discounts?: unknown[];
  };
  if (!profile.student && !profile.memberships?.length && !profile.discounts?.length) {
    db.prepare('UPDATE users SET profile_json=? WHERE id=?').run(
      JSON.stringify({
        student: true,
        memberships: ['REI Co-op'],
        discounts: [
          { label: 'Student discount', percent: 10, domains: ['nike.com'], requires: 'student' },
        ],
      }),
      userId,
    );
  }

  const headphones = item({
    title: 'Sony WH-1000XM5 Wireless Headphones',
    source: 'amazon',
    sourceUrl: 'https://www.amazon.com/dp/B09XS7JWHH',
    target: 270,
    max: 320,
  });
  snapshot(headphones.id, 'amazon.com', 299.99, 'https://www.amazon.com/dp/B09XS7JWHH');
  snapshot(headphones.id, 'bestbuy.com', 278.99, 'https://www.bestbuy.com/');
  if (headphones.created) {
    db.prepare(
      `INSERT INTO alerts (user_id,item_id,kind,price,retailer,url,detail_json)
       VALUES (?,?,'price_drop',278.99,'bestbuy.com','https://www.bestbuy.com/',?)`,
    ).run(userId, headphones.id, JSON.stringify({ source: 'seed', previous_low: 299.99 }));
  }

  const consoleItem = item({
    title: 'Nintendo Switch OLED',
    source: 'manual',
    sourceUrl: 'https://www.facebook.com/marketplace/',
    target: 200,
    max: 240,
    status: 'negotiating',
  });
  if (consoleItem.created) {
    const negotiationId = Number(
      db
        .prepare(
          `INSERT INTO negotiations (item_id,platform,listing_url,seller_label,listing_json)
           VALUES (?,'mock_seller','http://localhost:3000/mock-seller/','Taylor',?)`,
        )
        .run(
          consoleItem.id,
          JSON.stringify({ title: 'Nintendo Switch OLED', price: 250, currency: 'USD' }),
        ).lastInsertRowid,
    );
    db.prepare(
      `INSERT INTO messages (negotiation_id,role,text,ai_reasoning_json) VALUES (?, 'buyer_draft', ?, ?)`,
    ).run(
      negotiationId,
      'Would you consider $210 if I can pick it up this afternoon?',
      JSON.stringify({
        explanation: 'A respectful opening offer leaves room to meet near the target.',
      }),
    );
    db.prepare("INSERT INTO messages (negotiation_id,role,text) VALUES (?,'seller',?)").run(
      negotiationId,
      'I could do $225 if you can pick it up today.',
    );
  }

  const shoes = item({
    title: 'Nike Air Force 1 Low',
    source: 'instagram',
    sourceUrl: 'https://www.instagram.com/p/Cexample/',
    target: 80,
    max: 110,
  });
  snapshot(shoes.id, 'nike.com', 115, 'https://www.nike.com/');

  const seededAudit = db
    .prepare("SELECT id FROM audit_log WHERE user_id=? AND action='demo.seeded' LIMIT 1")
    .get(userId);
  if (!seededAudit)
    db.prepare(
      `INSERT INTO audit_log (user_id,actor,action,detail_json) VALUES (?,'system','demo.seeded',?)`,
    ).run(userId, JSON.stringify({ items: 3 }));
  return { headphones: headphones.created, console: consoleItem.created, shoes: shoes.created };
});

try {
  const result = seed();
  process.stdout.write(
    `Demo data ready. Added ${Object.values(result).filter(Boolean).length} new wishlist items.\n`,
  );
} finally {
  db.close();
}
