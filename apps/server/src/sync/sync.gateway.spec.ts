import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SyncGateway } from './sync.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { FakeSocket, fakeReq, redisMock } from './__test__/fakes';

describe('SyncGateway', () => {
  let gateway: SyncGateway;
  let jwt: { verify: jest.Mock };
  let rooms: { isMember: jest.Mock };
  let prisma: { room: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };
  let pub: ReturnType<typeof redisMock>;
  let sub: ReturnType<typeof redisMock>;

  beforeEach(async () => {
    jwt = { verify: jest.fn() };
    rooms = { isMember: jest.fn() };
    prisma = {
      room: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    pub = redisMock();
    sub = redisMock();

    const module = await Test.createTestingModule({
      providers: [
        SyncGateway,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: RoomsService, useValue: rooms },
        { provide: 'REDIS_PUB', useValue: pub },
        { provide: 'REDIS_SUB', useValue: sub },
      ],
    }).compile();

    gateway = module.get(SyncGateway);
  });

  afterEach(() => {
    // RoomState's Awareness schedules a setInterval (y-protocols, 3s tick).
    // Destroy any rooms the test created so that timer doesn't outlive the
    // test and fire after jest tears down modules.
    const rooms = (gateway as any).rooms as Map<string, { destroy(): void }>;
    rooms?.forEach(room => room.destroy());
    rooms?.clear();
  });

  describe('handleConnection auth', () => {
    it('closes with 4001 when the token fails verification', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('bad token');
      });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ token: 'garbage' }));

      expect(client.lastCloseCode()).toBe(4001);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('closes with 4003 when a valid user is not a member of a non-default room', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(false);

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'private-room', token: 'ok' }));

      expect(rooms.isMember).toHaveBeenCalledWith('private-room', 'user-1');
      expect(client.lastCloseCode()).toBe(4003);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('skips the membership check for the open "default" lobby', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect(rooms.isMember).not.toHaveBeenCalled();
      expect(client.send).toHaveBeenCalled(); // sync step1/step2 sent
    });
  });
});
