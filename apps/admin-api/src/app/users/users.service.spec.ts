import { InternalServerErrorException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService (cv-api HTTP client)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV, CV_API_URL: 'http://cv-api:8080', CV_API_ADMIN_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.restoreAllMocks();
  });

  it('GETs cv-api /api/admin/users with the API key header and returns rows', async () => {
    const rows = [{ id: 'u1', email: 'a@b.com', googleId: null, createdAt: '2026-01-01', profileCount: 3 }];
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, status: 200, json: async () => rows } as Response);

    const result = await new UsersService().findAll();

    expect(fetchMock).toHaveBeenCalledWith('http://cv-api:8080/api/admin/users', {
      headers: { 'X-Admin-Api-Key': 'test-key' },
    });
    expect(result).toEqual(rows);
  });

  it('throws when cv-api responds non-OK', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(new UsersService().findAll()).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('throws when cv-api is unreachable', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new UsersService().findAll()).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});
