import { Pool } from 'pg';

async function migrate() {
  const pool = new Pool({
    host: process.env.ADMIN_DB_HOST ?? 'localhost',
    port: parseInt(process.env.ADMIN_DB_PORT ?? '5434'),
    database: process.env.ADMIN_DB_NAME ?? 'admin',
    user: process.env.ADMIN_DB_USER ?? 'admin',
    password: process.env.ADMIN_DB_PASSWORD ?? 'changeme',
    ssl: process.env.ADMIN_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      google_id     TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  console.log('[migrate] Schema up to date');

  const seedEmail = process.env.ADMIN_SEED_EMAIL;
  if (seedEmail) {
    const res = await pool.query(
      `INSERT INTO admin_users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
      [seedEmail],
    );
    if (res.rowCount) {
      console.log(`[migrate] Seeded admin: ${seedEmail}`);
    } else {
      console.log(`[migrate] Admin already exists: ${seedEmail}`);
    }
  }

  await pool.end();
  console.log('[migrate] Done');
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
