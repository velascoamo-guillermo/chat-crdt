import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SyncGateway } from './sync.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { FakeSocket, fakeReq, redisMock } from './__test__/fakes';
import * as Y from 'yjs';
import { RoomState } from './room-state';

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

    // schedulePersist debounces with a 5s setTimeout per room — clear any
    // pending ones so they don't fire after the test/module is torn down.
    const persistTimers = (gateway as any).persistTimers as Map<string, ReturnType<typeof setTimeout>>;
    persistTimers?.forEach(timer => clearTimeout(timer));
    persistTimers?.clear();
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

  describe('handleConnection success', () => {
    it('sends sync step1 + step2 and tracks the client in the room', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      // step1 (state vector) + step2 (full snapshot) are two distinct sends
      expect(client.send.mock.calls.length).toBeGreaterThanOrEqual(2);

      const rooms = (gateway as any).rooms as Map<string, { clients: Set<unknown> }>;
      expect(rooms.get('default')!.clients.has(client)).toBe(true);

      const clientRoom = (gateway as any).clientRoom as WeakMap<object, string>;
      expect(clientRoom.get(client)).toBe('default');
    });

    it('upserts the room row on first load when no persisted state exists', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect(prisma.room.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: 'default' } }),
      );
    });
  });

  describe('doc update fan-out', () => {
    function seedRoom(roomId: string): RoomState {
      const room = new RoomState(roomId);
      (gateway as any).rooms.set(roomId, room);
      (gateway as any).registerRoomUpdateHandler(room);
      return room;
    }

    it('fans a delta out to every local client except the origin, and publishes to Redis', () => {
      const room = seedRoom('default');
      const origin = new FakeSocket();
      const other = new FakeSocket();
      room.clients.add(origin);
      room.clients.add(other);

      // Mutate the doc with `origin` as the transaction origin.
      room.doc.transact(() => {
        room.doc.getArray('messages').push([{ id: 'm1', content: 'hi' }]);
      }, origin);

      expect(other.send).toHaveBeenCalledTimes(1); // received the delta
      expect(origin.send).not.toHaveBeenCalled();   // not echoed to sender
      expect(pub.publish).toHaveBeenCalledWith(
        'room:update:default',
        expect.any(String),
      );
    });
  });
});
