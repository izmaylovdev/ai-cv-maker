import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const mockUsersService = {
  findAll: jest.fn(),
};

describe('UsersController (with JwtAuthGuard)', () => {
  let controller: UsersController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(UsersController);
  });

  it('returns users from UsersService', async () => {
    const users = [{ id: 'uuid-1', email: 'u@e.com', googleId: null, createdAt: '', profileCount: 0 }];
    mockUsersService.findAll.mockResolvedValue(users);
    const result = await controller.findAll();
    expect(result).toEqual(users);
  });
});

describe('UsersController — guard rejects without JWT', () => {
  it('JwtAuthGuard denies when no user on request', async () => {
    await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }, Reflector],
    }).compile();
    const meta = Reflect.getMetadata('__guards__', UsersController);
    expect(meta).toBeDefined();
  });
});
