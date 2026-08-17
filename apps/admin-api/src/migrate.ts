import { randomUUID } from 'node:crypto';
import { Timestamp } from '@google-cloud/firestore';
import {
  AdminUserDocument,
  ADMIN_USERS_COLLECTION,
  createFirestore,
} from './app/database/firestore';

/**
 * Firestore is schemaless, so there is no schema to create any more (ADR-0021).
 * What remains is the bootstrap seed: ADMIN_SEED_EMAIL is how the first
 * operator gets an account, and dropping it would lock everyone out of a fresh
 * deployment.
 */
async function migrate() {
  const seedEmail = process.env.ADMIN_SEED_EMAIL;
  if (!seedEmail) {
    console.log('[migrate] No ADMIN_SEED_EMAIL set, nothing to seed');
    return;
  }

  const firestore = createFirestore();
  const collection = firestore.collection(ADMIN_USERS_COLLECTION);

  const existing = await collection.where('email', '==', seedEmail).limit(1).get();
  if (existing.empty) {
    // The document id is the admin's id, a UUID as the Postgres primary key was.
    const document: AdminUserDocument = {
      email: seedEmail,
      password_hash: null,
      google_id: null,
      created_at: Timestamp.now(),
    };
    await collection.doc(randomUUID()).set(document);
    console.log(`[migrate] Seeded admin: ${seedEmail}`);
  } else {
    console.log(`[migrate] Admin already exists: ${seedEmail}`);
  }

  await firestore.terminate();
  console.log('[migrate] Done');
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
