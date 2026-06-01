import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          host: process.env.DB_HOST ?? 'localhost',
          port: parseInt(process.env.DB_PORT ?? '5433'),
          database: process.env.DB_NAME ?? 'cvmaker',
          user: process.env.DB_USER ?? 'cvmaker',
          password: process.env.DB_PASSWORD ?? 'changeme',
          ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
