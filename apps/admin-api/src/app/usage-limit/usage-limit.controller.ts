import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { UsageLimitService } from './usage-limit.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('usage-limit')
@UseGuards(JwtAuthGuard)
export class UsageLimitController {
  constructor(private readonly usageLimitService: UsageLimitService) {}

  @Get()
  get() {
    return this.usageLimitService.get();
  }

  @Put()
  set(@Body() body: { maxCostUsd: number }) {
    return this.usageLimitService.set(body?.maxCostUsd);
  }
}
