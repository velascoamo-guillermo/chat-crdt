import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('signed-token') } },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  describe('register', () => {
    it('hashes password and returns token + user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'uid-1', email: 'a@b.com', username: 'alice', password: 'hashed',
      });

      const result = await service.register({
        email: 'a@b.com', username: 'alice', password: 'plaintext123',
      });

      expect(result.token).toBe('signed-token');
      expect(result.user.email).toBe('a@b.com');
      expect(result.user.username).toBe('alice');
      expect(mockPrisma.user.create.mock.calls[0][0].data.password).not.toBe('plaintext123');
    });

    it('throws ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'uid-1' });
      await expect(
        service.register({ email: 'a@b.com', username: 'alice', password: 'plaintext123' })
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('returns token on valid credentials', async () => {
      const hashed = await bcrypt.hash('correct-pass', 10);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'uid-1', email: 'a@b.com', username: 'alice', password: hashed,
      });

      const result = await service.login({ email: 'a@b.com', password: 'correct-pass' });
      expect(result.token).toBe('signed-token');
    });

    it('throws UnauthorizedException on wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'uid-1', email: 'a@b.com', username: 'alice', password: '$2b$10$invalid',
      });
      await expect(
        service.login({ email: 'a@b.com', password: 'wrong' })
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException if user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nobody@b.com', password: 'pass' })
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
