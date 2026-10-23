import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const SECRET = 'users-controller-spec-secret';

const mockPrisma = {
  user: {
    update: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  roomKeyGrant: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};

/**
 * HTTP-level: real routing, JWT guard and global ValidationPipe (as in
 * main.ts), Prisma mocked. Covers what the service spec can't — auth on the
 * T15 routes and the status codes the mobile client branches on.
 */
describe('UsersController (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  let jwt: JwtService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule, JwtModule.register({ secret: SECRET })],
      controllers: [UsersController],
      providers: [
        UsersService,
        JwtStrategy,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: { get: () => SECRET } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/users/me/public-key`;
    jwt = module.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockPrisma.user.update.mockResolvedValue({});
  });

  const auth = (sub: string) => ({ Authorization: `Bearer ${jwt.sign({ sub, username: sub })}` });
  const put = (sub: string, publicKey: string) =>
    fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(sub) },
      body: JSON.stringify({ publicKey }),
    });
  // A syntactically valid 32-byte X25519 key in base64 (SetPublicKeyDto validates the shape).
  const KEY = Buffer.alloc(32, 7).toString('base64');

  describe('GET /users/me/public-key', () => {
    it('requires a token', async () => {
      const res = await fetch(base);
      expect(res.status).toBe(401);
    });

    it("returns the caller's published key, looked up by the token's subject", async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ publicKey: 'pub', publicKeyFp: 'fp' });

      const res = await fetch(base, { headers: auth('user-1') });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ publicKey: 'pub', publicKeyFp: 'fp' });
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    });

    it('returns nulls before anything is published', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ publicKey: null, publicKeyFp: null });

      const res = await fetch(base, { headers: auth('user-1') });

      expect(await res.json()).toEqual({ publicKey: null, publicKeyFp: null });
    });

    it('is 404 for a token whose user no longer exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await fetch(base, { headers: auth('ghost') });

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /users/me/public-key', () => {
    it('publishes a key nobody else holds', async () => {
      const res = await put('user-1', KEY);

      expect(res.status).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' } }));
    });

    it("is 409 for a key another user already published, and changes nothing", async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-2' });

      const res = await put('user-1', KEY);

      expect(res.status).toBe(409);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
