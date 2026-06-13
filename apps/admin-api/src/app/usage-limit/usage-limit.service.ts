import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

export interface UsageLimit {
  maxCostUsd: number;
}

/**
 * Reads and updates the global per-user LLM spending limit through cv-api
 * (US-AI-7 / ADR-0005). admin-api never touches the main database; cv-api owns
 * the limit and exposes it over the API-key-protected admin endpoint.
 */
@Injectable()
export class UsageLimitService {
  private readonly logger = new Logger(UsageLimitService.name);
  private readonly cvApiUrl = process.env.CV_API_URL ?? 'http://localhost:5050';
  private readonly adminKey = process.env.CV_API_ADMIN_KEY ?? '';

  async get(): Promise<UsageLimit> {
    const response = await this.fetchCvApi('GET');
    return (await response.json()) as UsageLimit;
  }

  async set(maxCostUsd: number): Promise<UsageLimit> {
    if (typeof maxCostUsd !== 'number' || !Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
      throw new BadRequestException('maxCostUsd must be a positive number');
    }
    const response = await this.fetchCvApi('PUT', { maxCostUsd });
    return (await response.json()) as UsageLimit;
  }

  private async fetchCvApi(method: 'GET' | 'PUT', body?: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.cvApiUrl}/api/admin/usage-limit`, {
        method,
        headers: {
          'X-Admin-Api-Key': this.adminKey,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      this.logger.error(`cv-api unreachable: ${(err as Error).message}`);
      throw new InternalServerErrorException('Failed to reach cv-api');
    }

    if (response.status === 400) {
      throw new BadRequestException('cv-api rejected the usage limit value');
    }
    if (!response.ok) {
      this.logger.error(`cv-api /api/admin/usage-limit returned ${response.status}`);
      throw new InternalServerErrorException('Failed to reach cv-api for usage limit');
    }
    return response;
  }
}
