import { waitForPortOpen } from '@nx/node/utils';
import { randomUUID } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import * as bcrypt from 'bcrypt';
import {
  AdminUserDocument,
  ADMIN_USERS_COLLECTION,
  createFirestore,
} from '../../src/app/database/firestore';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_USER_EMAIL } from './test-constants';

/* eslint-disable */
var __TEARDOWN_MESSAGE__: string;

module.exports = async function () {
  console.log('\nSetting up...\n');

  const host = process.env.HOST ?? 'localhost';
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await waitForPortOpen(port, { host });

  // Seed test data. admin-api and cv-api share one Firestore database and are
  // separated by collection (ADR-0021).
  const firestore = createFirestore();
  const adminUsers = firestore.collection(ADMIN_USERS_COLLECTION);
  const appUsers = firestore.collection('users');

  const passwordHash = await bcrypt.hash(TEST_ADMIN_PASSWORD, 10);

  const existingAdmin = await adminUsers.where('email', '==', TEST_ADMIN_EMAIL).limit(1).get();
  if (existingAdmin.empty) {
    const document: AdminUserDocument = {
      email: TEST_ADMIN_EMAIL,
      password_hash: passwordHash,
      google_id: null,
      created_at: Timestamp.now(),
    };
    await adminUsers.doc(randomUUID()).set(document);
  } else {
    await existingAdmin.docs[0].ref.update({ password_hash: passwordHash });
  }

  // The `users` collection belongs to cv-api, which owns its document shape;
  // this seed only has to be readable by cv-api's GET /api/admin/users, which
  // admin-api proxies (ADR-0005).
  const existingUser = await appUsers.where('email', '==', TEST_USER_EMAIL).limit(1).get();
  if (existingUser.empty) {
    await appUsers.doc(randomUUID()).set({
      email: TEST_USER_EMAIL,
      passwordHash: null,
      googleId: null,
      createdAt: Timestamp.now(),
    });
  }

  await firestore.terminate();

  globalThis.__TEARDOWN_MESSAGE__ = '\nTearing down...\n';
};
