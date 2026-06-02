import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';

export const ADMIN_PG_POOL = 'ADMIN_PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: ADMIN_PG_POOL,
      useFactory: () =>
        new Pool({
          host: process.env.ADMIN_DB_HOST ?? 'localhost',
          port: parseInt(process.env.ADMIN_DB_PORT ?? '5434'),
          database: process.env.ADMIN_DB_NAME ?? 'admin',
          user: process.env.ADMIN_DB_USER ?? 'admin',
          password: process.env.ADMIN_DB_PASSWORD ?? 'changeme',
          ssl: process.env.ADMIN_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        }),
    },
  ],
  exports: [ADMIN_PG_POOL],
})
export class AdminDatabaseModule {}
