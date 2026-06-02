import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AdminUsersService } from './admin-users.service';
import { JwtService } from '@nestjs/jwt';
// AdminUsersService is mocked fully — no real DB pool needed

const mockAdminUsersService = {
  findByEmail: jest.fn(),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed-jwt'),
};

const mockGoogleVerify = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockGoogleVerify,
  })),
}));

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: AdminUsersService, useValue: mockAdminUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('loginWithGoogle', () => {
    it('throws UnauthorizedException when Google token is invalid', async () => {
      mockGoogleVerify.mockRejectedValue(new Error('bad token'));
      await expect(service.loginWithGoogle('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws ForbiddenException when email is not an admin', async () => {
      mockGoogleVerify.mockResolvedValue({
        getPayload: () => ({ email: 'stranger@example.com', sub: 'g-sub' }),
      });
      mockAdminUsersService.findByEmail.mockResolvedValue(null);
      await expect(service.loginWithGoogle('valid-token')).rejects.toThrow(ForbiddenException);
    });

    it('returns accessToken when email is an authorized admin', async () => {
      mockGoogleVerify.mockResolvedValue({
        getPayload: () => ({ email: 'admin@example.com', sub: 'g-sub' }),
      });
      mockAdminUsersService.findByEmail.mockResolvedValue({
        id: 'uuid-1',
        email: 'admin@example.com',
      });
      const result = await service.loginWithGoogle('valid-token');
      expect(result).toEqual({ accessToken: 'signed-jwt' });
      expect(mockJwtService.sign).toHaveBeenCalledWith({ sub: 'uuid-1', email: 'admin@example.com' });
    });
  });

  describe('loginWithPassword', () => {
    it('throws UnauthorizedException when email is not found', async () => {
      mockAdminUsersService.findByEmail.mockResolvedValue(null);
      await expect(service.loginWithPassword('x@example.com', 'pass')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password hash is null', async () => {
      mockAdminUsersService.findByEmail.mockResolvedValue({
        id: 'uuid-1',
        email: 'admin@example.com',
        passwordHash: null,
      });
      await expect(service.loginWithPassword('admin@example.com', 'pass')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when password does not match', async () => {
      mockAdminUsersService.findByEmail.mockResolvedValue({
        id: 'uuid-1',
        email: 'admin@example.com',
        passwordHash: '$2b$10$invalidhash',
      });
      await expect(service.loginWithPassword('admin@example.com', 'wrong')).rejects.toThrow(UnauthorizedException);
    });

    it('returns accessToken when credentials are valid', async () => {
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash('correct', 10);
      mockAdminUsersService.findByEmail.mockResolvedValue({
        id: 'uuid-1',
        email: 'admin@example.com',
        passwordHash: hash,
      });
      const result = await service.loginWithPassword('admin@example.com', 'correct');
      expect(result).toEqual({ accessToken: 'signed-jwt' });
    });
  });
});
