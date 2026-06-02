import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../database/admin-database.module';

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string | null;
  googleId: string | null;
}

@Injectable()
export class AdminUsersService {
  constructor(@Inject(ADMIN_PG_POOL) private readonly pool: Pool) {}

  async findByEmail(email: string): Promise<AdminUser | null> {
    const result = await this.pool.query<{
      id: string;
      email: string;
      password_hash: string | null;
      google_id: string | null;
    }>(
      `SELECT id, email, password_hash, google_id FROM admin_users WHERE email = $1`,
      [email]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      googleId: row.google_id,
    };
  }
}
