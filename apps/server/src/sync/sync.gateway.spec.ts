import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { SyncGateway } from './sync.gateway';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { MetricsService } from '../metrics/metrics.service';
import { FakeSocket, fakeReq, redisMock } from './__test__/fakes';
import * as Y from 'yjs';
import { RoomState } from './room-state';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';

function metricsMock() {
  return {
    incWsConnections: jest.fn(),
    decWsConnections: jest.fn(),
    incRoomsLoaded: jest.fn(),
    decRoomsLoaded: jest.fn(),
    incMessages: jest.fn(),
    incFanoutBytes: jest.fn(),
    observePersistDurationSeconds: jest.fn(),
    setYjsStateBytes: jest.fn(),
  };
}

describe('SyncGateway', () => {
  let gateway: SyncGateway;
  let jwt: { verify: jest.Mock };
  let rooms: { isMember: jest.Mock };
  let prisma: { room: { findUnique: jest.Mock; upsert: jest.Mock; update: jest.Mock } };
  let pub: ReturnType<typeof redisMock>;
  let sub: ReturnType<typeof redisMock>;
  let metrics: ReturnType<typeof metricsMock>;

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
    metrics = metricsMock();

    const module = await Test.createTestingModule({
      providers: [
        SyncGateway,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: RoomsService, useValue: rooms },
        { provide: 'REDIS_PUB', useValue: pub },
        { provide: 'REDIS_SUB', useValue: sub },
        { provide: MetricsService, useValue: metrics },
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

    it('marks the client alive on connect and resets alive on pong', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));

      expect((gateway as any).alive.get(client)).toBe(true);

      // Simulate a missed cycle, then a pong arriving.
      (gateway as any).alive.set(client, false);
      client.emit('pong');
      expect((gateway as any).alive.get(client)).toBe(true);
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
      room.clients.add(origin as any);
      room.clients.add(other as any);

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

    it('does not re-publish updates that arrived from Redis', () => {
      const room = seedRoom('default');
      const local = new FakeSocket();
      room.clients.add(local as any);
      pub.publish.mockClear();

      // Build a delta from a separate source doc, then apply it as if from Redis.
      const source = new Y.Doc();
      source.getArray('messages').push([{ id: 'm2', content: 'from other instance' }]);
      const delta = Y.encodeStateAsUpdate(source);

      Y.applyUpdate(room.doc, delta, 'redis');

      expect(local.send).toHaveBeenCalledTimes(1); // fanned out locally
      expect(pub.publish).not.toHaveBeenCalled();  // not echoed back to Redis
    });
  });

  describe('handleDisconnect', () => {
    it('removes the client from the room and clears its awareness states', () => {
      // The room-empty branch schedules a 30s GC setTimeout; fake timers
      // keep it (and RoomState's Awareness 3s interval) from leaking.
      jest.useFakeTimers();

      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);

      const client = new FakeSocket();
      room.clients.add(client as any);
      (gateway as any).clientRoom.set(client, 'default');
      (gateway as any).awarenessIds.set(client, new Set([42]));
      room.awareness.states.set(42, { user: 'someone' });

      gateway.handleDisconnect(client as any);

      expect(room.clients.has(client as any)).toBe(false);
      expect(room.awareness.getStates().has(42)).toBe(false);
      expect((gateway as any).awarenessIds.has(client)).toBe(false);

      jest.useRealTimers();
    });

    it('is a no-op for a socket that never joined a room', () => {
      const client = new FakeSocket();
      expect(() => gateway.handleDisconnect(client as any)).not.toThrow();
    });
  });

  describe('sweepHeartbeats', () => {
    function withClients(...clients: FakeSocket[]) {
      (gateway as any).server = { clients: new Set(clients) };
    }

    it('terminates a client that missed the previous pong', () => {
      const dead = new FakeSocket();
      withClients(dead);
      (gateway as any).alive.set(dead, false); // missed last cycle

      gateway.sweepHeartbeats();

      expect(dead.terminate).toHaveBeenCalledTimes(1);
      expect(dead.ping).not.toHaveBeenCalled();
    });

    it('pings a live client and arms it for the next cycle', () => {
      const live = new FakeSocket();
      withClients(live);
      (gateway as any).alive.set(live, true);

      gateway.sweepHeartbeats();

      expect(live.ping).toHaveBeenCalledTimes(1);
      expect(live.terminate).not.toHaveBeenCalled();
      expect((gateway as any).alive.get(live)).toBe(false); // re-armed
    });
  });

  describe('heartbeat lifecycle', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('runs the sweep on the interval after init and stops after destroy', () => {
      const sweep = jest.spyOn(gateway, 'sweepHeartbeats').mockImplementation(() => {});
      const fakeServer = { clients: new Set() };

      gateway.afterInit(fakeServer as any);
      jest.advanceTimersByTime(30_000);
      expect(sweep).toHaveBeenCalledTimes(1);

      gateway.onModuleDestroy();
      jest.advanceTimersByTime(60_000);
      expect(sweep).toHaveBeenCalledTimes(1); // no further ticks after destroy

      sweep.mockRestore();
    });
  });

  describe('yjsState size monitoring', () => {
    it('warns when the persisted blob crosses the retention threshold', () => {
      const warn = jest.spyOn((gateway as any).logger, 'warn');
      (gateway as any).warnIfStateLarge('default', 2_000_000);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('default'));
    });

    it('stays silent below the threshold', () => {
      const warn = jest.spyOn((gateway as any).logger, 'warn');
      warn.mockClear();
      (gateway as any).warnIfStateLarge('default', 1_000);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('RoomState GC', () => {
    it('constructs the room doc with garbage collection enabled', () => {
      const room = new RoomState('default');
      expect(room.doc.gc).toBe(true);
    });
  });

  describe('metrics emission', () => {
    it('increments ws_connections on connect and decrements on disconnect', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));
      expect(metrics.incWsConnections).toHaveBeenCalledTimes(1);

      gateway.handleDisconnect(client as any);
      expect(metrics.decWsConnections).toHaveBeenCalledTimes(1);
    });

    it('increments rooms_loaded when a room is first created', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });
      rooms.isMember.mockResolvedValue(true);

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'fresh-room', token: 'ok' }));

      expect(metrics.incRoomsLoaded).toHaveBeenCalledTimes(1);
    });

    it('increments messages_total labeled "sync" on a sync message', async () => {
      jwt.verify.mockReturnValue({ sub: 'user-1' });

      const client = new FakeSocket();
      await gateway.handleConnection(client as any, fakeReq({ room: 'default', token: 'ok' }));
      metrics.incMessages.mockClear();

      const room = (gateway as any).rooms.get('default') as RoomState;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0); // MSG_SYNC
      syncProtocol.writeSyncStep1(encoder, room.doc);
      const data = Buffer.from(encoding.toUint8Array(encoder));

      (gateway as any).handleMessage(client, room, data);

      expect(metrics.incMessages).toHaveBeenCalledWith('sync');
    });

    it('records fanout_bytes_total when a doc update is published to Redis', () => {
      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);
      (gateway as any).registerRoomUpdateHandler(room);

      room.doc.transact(() => {
        room.doc.getArray('messages').push([{ id: 'm1', content: 'hi' }]);
      });

      expect(metrics.incFanoutBytes).toHaveBeenCalledTimes(1);
      expect(metrics.incFanoutBytes).toHaveBeenCalledWith(expect.any(Number));
    });

    it('observes persist_duration_seconds and sets yjs_state_bytes on persist', async () => {
      const room = new RoomState('default');
      room.doc.getArray('messages').push([{ id: 'm1', content: 'hi' }]);

      await (gateway as any).persistRoomState(room);
      room.destroy();

      expect(metrics.observePersistDurationSeconds).toHaveBeenCalledWith(expect.any(Number));
      expect(metrics.setYjsStateBytes).toHaveBeenCalledWith('default', expect.any(Number));
    });

    it('decrements rooms_loaded when an empty room is garbage collected', () => {
      jest.useFakeTimers();

      const room = new RoomState('default');
      (gateway as any).rooms.set('default', room);
      const client = new FakeSocket();
      room.clients.add(client as any);
      (gateway as any).clientRoom.set(client, 'default');

      gateway.handleDisconnect(client as any);
      jest.advanceTimersByTime(30_000);

      expect(metrics.decRoomsLoaded).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });
});
