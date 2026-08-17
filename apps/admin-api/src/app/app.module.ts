import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FirestoreModule } from './database/firestore.module';
import { UsersModule } from './users/users.module';
import { UsageLimitModule } from './usage-limit/usage-limit.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [FirestoreModule, UsersModule, UsageLimitModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
