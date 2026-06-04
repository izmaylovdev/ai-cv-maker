import axios from 'axios';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './support/test-constants';

// NestJS returns 201 for POST by default
describe('GET /api', () => {
  it('returns health message', async () => {
    const res = await axios.get('/api');
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'Hello API' });
  });
});

describe('POST /api/auth/login', () => {
  it('returns a JWT for valid admin credentials', async () => {
    const res = await axios.post('/api/auth/login', {
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
    });
    expect(res.status).toBe(201);
    expect(res.data).toHaveProperty('accessToken');
    expect(typeof res.data.accessToken).toBe('string');
    expect(res.data.accessToken.length).toBeGreaterThan(0);
  });

  it('returns 401 for wrong password', async () => {
    await expect(
      axios.post('/api/auth/login', {
        email: TEST_ADMIN_EMAIL,
        password: 'definitely-wrong-password',
      })
    ).rejects.toMatchObject({ response: { status: 401 } });
  });

  it('returns 401 for non-admin email', async () => {
    await expect(
      axios.post('/api/auth/login', {
        email: 'nobody@unknown.example',
        password: 'any-password',
      })
    ).rejects.toMatchObject({ response: { status: 401 } });
  });
});

describe('GET /api/users', () => {
  let token: string;

  beforeAll(async () => {
    const res = await axios.post('/api/auth/login', {
      email: TEST_ADMIN_EMAIL,
      password: TEST_ADMIN_PASSWORD,
    });
    token = res.data.accessToken;
  });

  it('returns user list when authenticated', async () => {
    const res = await axios.get('/api/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    // Each user has the expected shape
    for (const user of res.data) {
      expect(user).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
        profileCount: expect.any(Number),
      });
    }
  });

  it('includes the seeded test user', async () => {
    const res = await axios.get('/api/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const emails: string[] = res.data.map((u: { email: string }) => u.email);
    expect(emails).toContain('e2e-user@test.local');
  });

  it('returns 401 when no Authorization header is provided', async () => {
    await expect(axios.get('/api/users')).rejects.toMatchObject({
      response: { status: 401 },
    });
  });

  it('returns 401 for an invalid JWT', async () => {
    await expect(
      axios.get('/api/users', {
        headers: { Authorization: 'Bearer this.is.not.a.valid.token' },
      })
    ).rejects.toMatchObject({ response: { status: 401 } });
  });
});
