import { Module } from '@nestjs/common';
import { UsageLimitController } from './usage-limit.controller';
import { UsageLimitService } from './usage-limit.service';

@Module({
  controllers: [UsageLimitController],
  providers: [UsageLimitService],
})
export class UsageLimitModule {}
