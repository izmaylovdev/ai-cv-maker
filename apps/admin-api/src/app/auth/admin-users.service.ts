import { Inject, Injectable } from '@nestjs/common';
import { Firestore } from '@google-cloud/firestore';
import { AdminUserDocument, ADMIN_USERS_COLLECTION } from '../database/firestore';
import { FIRESTORE } from '../database/firestore.module';

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string | null;
  googleId: string | null;
}

@Injectable()
export class AdminUsersService {
  constructor(@Inject(FIRESTORE) private readonly firestore: Firestore) {}

  async findByEmail(email: string): Promise<AdminUser | null> {
    // `email` was a UNIQUE column in Postgres; Firestore has no unique
    // constraint, so uniqueness is now a writer-side invariant (migrate.ts
    // checks before seeding) and the read takes the first match.
    const snapshot = await this.firestore
      .collection(ADMIN_USERS_COLLECTION)
      .where('email', '==', email)
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    const data = doc.data() as AdminUserDocument;
    return {
      id: doc.id,
      email: data.email,
      passwordHash: data.password_hash ?? null,
      googleId: data.google_id ?? null,
    };
  }
}
