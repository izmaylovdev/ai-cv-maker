import { killPort } from '@nx/node/utils';
import { Pool } from 'pg';
import { TEST_ADMIN_EMAIL, TEST_USER_EMAIL } from './test-constants';

/* eslint-disable */

module.exports = async function () {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Clean up seeded test data
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

  await adminPool.query(`DELETE FROM admin_users WHERE email = $1`, [TEST_ADMIN_EMAIL]);
  await appPool.query(`DELETE FROM "Users" WHERE "Email" = $1`, [TEST_USER_EMAIL]);

  await adminPool.end();
  await appPool.end();

  await killPort(port);
  console.log(globalThis.__TEARDOWN_MESSAGE__);
};
