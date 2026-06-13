import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

export interface UserRow {
  id: string;
  email: string;
  googleId: string | null;
  createdAt: string;
  profileCount: number;
}

/**
 * Reads the registered-users list from cv-api (ADR-0005). admin-api no longer
 * touches the main database; cv-api owns that schema and exposes it over an
 * API-key-protected endpoint.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly cvApiUrl = process.env.CV_API_URL ?? 'http://localhost:5050';
  private readonly adminKey = process.env.CV_API_ADMIN_KEY ?? '';

  async findAll(): Promise<UserRow[]> {
    let response: Response;
    try {
      response = await fetch(`${this.cvApiUrl}/api/admin/users`, {
        headers: { 'X-Admin-Api-Key': this.adminKey },
      });
    } catch (err) {
      this.logger.error(`cv-api unreachable: ${(err as Error).message}`);
      throw new InternalServerErrorException('Failed to reach cv-api');
    }

    if (!response.ok) {
      this.logger.error(`cv-api /api/admin/users returned ${response.status}`);
      throw new InternalServerErrorException('Failed to load users from cv-api');
    }

    return (await response.json()) as UserRow[];
  }
}
