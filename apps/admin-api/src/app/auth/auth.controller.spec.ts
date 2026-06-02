import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

const mockAuthService = {
  loginWithGoogle: jest.fn(),
  loginWithPassword: jest.fn(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    }).compile();
    controller = module.get(AuthController);
  });

  describe('POST /auth/google', () => {
    it('delegates to authService.loginWithGoogle and returns the token', async () => {
      mockAuthService.loginWithGoogle.mockResolvedValue({ accessToken: 'jwt' });
      const result = await controller.googleLogin({ idToken: 'id-tok' });
      expect(mockAuthService.loginWithGoogle).toHaveBeenCalledWith('id-tok');
      expect(result).toEqual({ accessToken: 'jwt' });
    });
  });

  describe('POST /auth/login', () => {
    it('delegates to authService.loginWithPassword and returns the token', async () => {
      mockAuthService.loginWithPassword.mockResolvedValue({ accessToken: 'jwt' });
      const result = await controller.emailLogin({ email: 'a@b.com', password: 'pass' });
      expect(mockAuthService.loginWithPassword).toHaveBeenCalledWith('a@b.com', 'pass');
      expect(result).toEqual({ accessToken: 'jwt' });
    });
  });
});
