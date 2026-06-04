import { waitForPortOpen } from '@nx/node/utils';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_USER_EMAIL } from './test-constants';

/* eslint-disable */
var __TEARDOWN_MESSAGE__: string;

module.exports = async function () {
  console.log('\nSetting up...\n');

  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await waitForPortOpen(port, { host });

  // Seed test data
  const adminPool = new Pool({
    host: process.env.ADMIN_DB_HOST ?? 'localhost',
    port: parseInt(process.env.ADMIN_DB_PORT ?? '5434'),
    database: process.env.ADMIN_DB_NAME ?? 'admin',
    user: process.env.ADMIN_DB_USER ?? 'admin',
    password: process.env.ADMIN_DB_PASSWORD ?? 'changeme',
    ssl: process.env.ADMIN_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const appPool = new Pool({
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5433'),
    database: process.env.DB_NAME ?? 'cvmaker',
    user: process.env.DB_USER ?? 'cvmaker',
    password: process.env.DB_PASSWORD ?? 'changeme',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 10);

  await adminPool.query(
    `INSERT INTO admin_users (id, email, password_hash, google_id)
     VALUES (gen_random_uuid(), $1, $2, NULL)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [TEST_ADMIN_EMAIL, passwordHash]
  );

  await appPool.query(
    `INSERT INTO "Users" ("Id", "Email", "GoogleId", "CreatedAt")
     VALUES (gen_random_uuid(), $1, NULL, NOW())
     ON CONFLICT ("Email") DO NOTHING`,
    [TEST_USER_EMAIL]
  );

  await adminPool.end();
  await appPool.end();

  globalThis.__TEARDOWN_MESSAGE__ = '\nTearing down...\n';
};
