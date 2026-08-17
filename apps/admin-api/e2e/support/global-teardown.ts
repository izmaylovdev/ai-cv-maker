import { killPort } from '@nx/node/utils';
import { ADMIN_USERS_COLLECTION, createFirestore } from '../../src/app/database/firestore';
import { TEST_ADMIN_EMAIL, TEST_USER_EMAIL } from './test-constants';

/* eslint-disable */

module.exports = async function () {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Clean up seeded test data
  const firestore = createFirestore();

  const seededAdmins = await firestore
    .collection(ADMIN_USERS_COLLECTION)
    .where('email', '==', TEST_ADMIN_EMAIL)
    .get();
  const seededUsers = await firestore
    .collection('users')
    .where('email', '==', TEST_USER_EMAIL)
    .get();

  await Promise.all([...seededAdmins.docs, ...seededUsers.docs].map((doc) => doc.ref.delete()));

  await firestore.terminate();

  await killPort(port);
  console.log(globalThis.__TEARDOWN_MESSAGE__);
};
