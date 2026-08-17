import { Firestore, Timestamp } from '@google-cloud/firestore';

/**
 * Top-level collection holding admin accounts. admin-api shares one Firestore
 * database with cv-api and is separated from it by collection name only, since
 * the free tier covers exactly one database per project (ADR-0021).
 */
export const ADMIN_USERS_COLLECTION = 'admin_users';

/**
 * Stored shape of an `admin_users` document. The field names are the old
 * Postgres column names kept verbatim, and the document id is the row's `id`
 * UUID, so the one-off data migration copies rows across without transforming
 * them (ADR-0021).
 */
export interface AdminUserDocument {
  email: string;
  password_hash: string | null;
  google_id: string | null;
  created_at: Timestamp;
}

/**
 * Builds the Firestore client. Credentials come from the runtime service
 * account (ADR-0021) — there is no database password. The SDK redirects itself
 * to a local emulator when `FIRESTORE_EMULATOR_HOST` is set, so that needs no
 * wiring here.
 */
export function createFirestore(): Firestore {
  return new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
}
