import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

export interface UserRow {
  id: string;
  email: string;
  googleId: string | null;
  createdAt: string;
  profileCount: number;
}

@Injectable()
export class UsersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findAll(): Promise<UserRow[]> {
    const result = await this.pool.query<{
      id: string;
      email: string;
      google_id: string | null;
      created_at: string;
      profile_count: string;
    }>(
      `SELECT u."Id" AS id, u."Email" AS email, u."GoogleId" AS google_id,
              u."CreatedAt" AS created_at, COUNT(p."Id") AS profile_count
       FROM "Users" u
       LEFT JOIN "Profiles" p ON p."UserId" = u."Id"
       GROUP BY u."Id", u."Email", u."GoogleId", u."CreatedAt"
       ORDER BY u."CreatedAt" DESC`
    );
    return result.rows.map((row) => ({
      id: row.id,
      email: row.email,
      googleId: row.google_id,
      createdAt: row.created_at,
      profileCount: parseInt(row.profile_count, 10),
    }));
  }
}
