import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import { Server, WebSocket, RawData } from 'ws';
import { IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { RoomState } from './room-state';
import { randomUUID } from 'crypto';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const ROOM_GC_DELAY_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 5_000;

const UPDATE_CHANNEL_PREFIX = 'room:update:';
const AWARENESS_CHANNEL_PREFIX = 'room:awareness:';

// DoS guards: reject oversized frames and clients that flood the socket.
const MAX_WS_MESSAGE_BYTES = 64 * 1024; // 64 KiB per frame
const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_MSGS = 60; // per client per window

const HEARTBEAT_INTERVAL_MS = 30_000;

interface RedisPayload {
  origin: string;
  update: string; // base64 incremental update
}

interface RateState {
  count: number;
  windowStart: number;
}

@WebSocketGateway({ path: '/sync' })
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(SyncGateway.name);
  private readonly instanceId = randomUUID();
  private readonly rooms = new Map<string, RoomState>();
  // Stores Promise<RoomState> during initialization to prevent race on concurrent first connections
  private readonly roomInitMap = new Map<string, Promise<RoomState>>();
  private readonly clientRoom = new WeakMap<WebSocket, string>();
  private readonly persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly clientRate = new WeakMap<WebSocket, RateState>();
  // Awareness clientIDs announced by each socket, so we can clear them on disconnect.
  private readonly awarenessIds = new WeakMap<WebSocket, Set<number>>();
  // Liveness flag per socket: true on connect + on every pong. A sweep that
  // finds `false` evicts the socket (it missed the previous ping's pong).
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly roomsService: RoomsService,
    @Inject('REDIS_PUB') private readonly pub: Redis,
    @Inject('REDIS_SUB') private readonly sub: Redis,
  ) {}

  onModuleInit() {
    this.sub.psubscribe(`${UPDATE_CHANNEL_PREFIX}*`, `${AWARENESS_CHANNEL_PREFIX}*`);
    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const payload: RedisPayload = JSON.parse(message);

      // Skip messages this instance published — local clients already received them.
      if (payload.origin === this.instanceId) return;

      if (channel.startsWith(UPDATE_CHANNEL_PREFIX)) {
        const room = this.rooms.get(channel.slice(UPDATE_CHANNEL_PREFIX.length));
        if (!room) return;
        // Apply with origin 'redis'. The doc 'update' handler fans this out to
        // local clients and skips re-publishing it back to Redis.
        Y.applyUpdate(room.doc, Buffer.from(payload.update, 'base64'), 'redis');
      } else if (channel.startsWith(AWARENESS_CHANNEL_PREFIX)) {
        const room = this.rooms.get(channel.slice(AWARENESS_CHANNEL_PREFIX.length));
        if (!room) return;
        // Same pattern: the awareness 'update' handler fans out locally.
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          Buffer.from(payload.update, 'base64'),
          'redis',
        );
      }
    });
  }

  async handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url!, 'http://localhost');
    const roomId = url.searchParams.get('room') ?? 'default';

    // Token arrives via Sec-WebSocket-Protocol: "bearer, <jwt>" — not the query string.
    const offered = (req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map(s => s.trim());
    const token = offered[0] === 'bearer' ? offered[1] ?? '' : '';

    let userId: string;
    try {
      const payload = this.jwt.verify(token) as { sub: string };
      userId = payload.sub;
    } catch {
      client.close(4001, 'Unauthorized');
      return;
    }

    // 'default' is an open lobby — any authenticated user may join.
    // All other rooms require explicit membership (POST /rooms or POST /rooms/:name/join).
    if (roomId !== 'default') {
      const allowed = await this.roomsService.isMember(roomId, userId);
      if (!allowed) {
        client.close(4003, 'Forbidden');
        return;
      }
    }

    const room = await this.getOrCreateRoom(roomId);

    room.clients.add(client);
    this.clientRoom.set(client, roomId);

    // Step 1 — send server state vector so client can compute the diff it needs to send us
    const enc1 = encoding.createEncoder();
    encoding.writeVarUint(enc1, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc1, room.doc);
    client.send(encoding.toUint8Array(enc1));

    // Step 2 — push full current state to the new client (empty SV = full snapshot)
    const enc2 = encoding.createEncoder();
    encoding.writeVarUint(enc2, MSG_SYNC);
    syncProtocol.writeSyncStep2(enc2, room.doc, new Uint8Array([0]));
    client.send(encoding.toUint8Array(enc2));

    // Awareness snapshot — so onlineCount / typing are correct before the next change
    const states = room.awareness.getStates();
    if (states.size > 0) {
      const enc3 = encoding.createEncoder();
      encoding.writeVarUint(enc3, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        enc3,
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]),
      );
      client.send(encoding.toUint8Array(enc3));
    }

    const onMessage = (data: RawData) => this.handleMessage(client, room, data as Buffer);
    const onClose = () => client.removeAllListeners('message');
    client.on('message', onMessage);
    client.once('close', onClose);

    this.logger.log(`Client connected to room "${roomId}". Room size: ${room.clients.size}`);
  }

  handleDisconnect(client: WebSocket) {
    const roomId = this.clientRoom.get(client);
    if (!roomId) return;
    this.clientRoom.delete(client);

    const room = this.rooms.get(roomId);
    if (!room) return;

    room.clients.delete(client);

    // Clear this socket's awareness states so it doesn't linger as a ghost
    // online user / stuck typing indicator. The awareness 'update' handler
    // propagates the removal to local clients and other instances.
    const ids = this.awarenessIds.get(client);
    if (ids && ids.size > 0) {
      awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], 'disconnect');
      this.awarenessIds.delete(client);
    }

    this.logger.log(`Client disconnected from room "${roomId}". Room size: ${room.clients.size}`);

    if (room.clients.size === 0) {
      setTimeout(() => {
        if (room.clients.size === 0) {
          // Flush any pending persist before GC
          const timer = this.persistTimers.get(roomId);
          if (timer) {
            clearTimeout(timer);
            this.persistTimers.delete(roomId);
            this.persistRoomState(room).catch(err =>
              this.logger.error(`Failed final persist for room "${roomId}": ${err.message}`)
            );
          }
          room.destroy();
          this.rooms.delete(roomId);
          this.roomInitMap.delete(roomId);
        }
      }, ROOM_GC_DELAY_MS);
    }
  }

  private handleMessage(client: WebSocket, room: RoomState, data: Buffer) {
    if (data.length > MAX_WS_MESSAGE_BYTES) {
      this.logger.warn(`Oversized frame (${data.length}B) in room "${room.roomId}" — closing client`);
      client.close(1009, 'Message too large');
      return;
    }
    if (this.isRateLimited(client)) {
      this.logger.warn(`Rate limit exceeded in room "${room.roomId}" — closing client`);
      client.close(4029, 'Rate limit exceeded');
      return;
    }
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        // readSyncMessage applies the client's update to room.doc with `client`
        // as the transaction origin. Local fan-out, Redis publish and persist
        // are all driven from the doc 'update' handler in registerRoomUpdateHandler.
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);

        if (encoding.length(encoder) > 1) {
          client.send(encoding.toUint8Array(encoder));
        }
      } else if (msgType === MSG_AWARENESS) {
        // Apply with `client` as origin; the awareness 'update' handler tracks
        // the client's IDs, fans out to local clients and publishes to Redis.
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);
      }
    } catch (err: any) {
      this.logger.error(`Error handling message: ${err.message}`);
    }
  }

  /** Fixed-window per-client message rate limiter. */
  private isRateLimited(client: WebSocket): boolean {
    const now = Date.now();
    const state = this.clientRate.get(client);
    if (!state || now - state.windowStart >= RATE_LIMIT_WINDOW_MS) {
      this.clientRate.set(client, { count: 1, windowStart: now });
      return false;
    }
    state.count++;
    return state.count > RATE_LIMIT_MAX_MSGS;
  }

  /**
   * Ping every client; terminate any that missed the previous cycle's pong.
   * `terminate()` fires 'close', so handleDisconnect runs the normal cleanup
   * (awareness removal + room GC) — no special-casing here.
   */
  sweepHeartbeats(): void {
    this.server.clients.forEach((client: WebSocket) => {
      if (this.alive.get(client) === false) {
        this.logger.warn('Heartbeat timeout — terminating dead socket');
        client.terminate();
        return;
      }
      this.alive.set(client, false);
      client.ping();
    });
  }

  private getOrCreateRoom(roomId: string): Promise<RoomState> {
    let p = this.roomInitMap.get(roomId);
    if (!p) {
      const room = new RoomState(roomId);
      this.rooms.set(roomId, room);
      p = this.loadRoomState(room).then(() => {
        this.registerRoomUpdateHandler(room);
        this.registerRoomAwarenessHandler(room);
        return room;
      });
      this.roomInitMap.set(roomId, p);
    }
    return p;
  }

  /**
   * Single source of truth for doc propagation. Fires on every doc mutation
   * with the true incremental update and its transaction origin:
   * - a client WebSocket  → another instance hasn't seen it: publish to Redis + persist
   * - 'redis'             → already came from another instance: fan out locally only
   * In all cases, fan the delta out to local clients except the originating one.
   */
  private registerRoomUpdateHandler(room: RoomState): void {
    room.doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const msg = encoding.toUint8Array(encoder);

      room.clients.forEach(client => {
        if (client !== origin && client.readyState === WebSocket.OPEN) client.send(msg);
      });

      if (origin === 'redis') return; // came from another instance — don't echo back

      const payload: RedisPayload = {
        origin: this.instanceId,
        update: Buffer.from(update).toString('base64'),
      };
      this.pub.publish(`${UPDATE_CHANNEL_PREFIX}${room.roomId}`, JSON.stringify(payload));
      this.schedulePersist(room);
    });
  }

  /**
   * Single source of truth for awareness (presence/typing) propagation.
   * Mirrors registerRoomUpdateHandler: fan out to local clients, track each
   * socket's controlled clientIDs for disconnect cleanup, and forward to other
   * instances via Redis unless the change itself came from Redis.
   */
  private registerRoomAwarenessHandler(room: RoomState): void {
    room.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => {
        const changed = [...added, ...updated, ...removed];
        if (changed.length === 0) return;

        if (origin instanceof WebSocket && room.clients.has(origin)) {
          let set = this.awarenessIds.get(origin);
          if (!set) {
            set = new Set();
            this.awarenessIds.set(origin, set);
          }
          for (const id of added) set.add(id);
          for (const id of updated) set.add(id);
          for (const id of removed) set.delete(id);
        }

        const update = awarenessProtocol.encodeAwarenessUpdate(room.awareness, changed);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, update);
        const msg = encoding.toUint8Array(enc);

        room.clients.forEach(client => {
          if (client !== origin && client.readyState === WebSocket.OPEN) client.send(msg);
        });

        if (origin === 'redis') return; // already from another instance

        const payload: RedisPayload = {
          origin: this.instanceId,
          update: Buffer.from(update).toString('base64'),
        };
        this.pub.publish(`${AWARENESS_CHANNEL_PREFIX}${room.roomId}`, JSON.stringify(payload));
      },
    );
  }

  private async loadRoomState(room: RoomState): Promise<void> {
    const dbRoom = await this.prisma.room.findUnique({ where: { name: room.roomId } });
    if (dbRoom?.yjsState) {
      Y.applyUpdate(room.doc, new Uint8Array(dbRoom.yjsState));
    } else {
      await this.prisma.room.upsert({
        where: { name: room.roomId },
        create: { name: room.roomId },
        update: {},
      });
    }
  }

  private schedulePersist(room: RoomState): void {
    const existing = this.persistTimers.get(room.roomId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.persistTimers.delete(room.roomId);
      this.persistRoomState(room).catch(err =>
        this.logger.error(`Failed to persist room "${room.roomId}": ${err.message}`)
      );
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimers.set(room.roomId, timer);
  }

  private async persistRoomState(room: RoomState): Promise<void> {
    const state = Y.encodeStateAsUpdate(room.doc);
    await this.prisma.room.update({
      where: { name: room.roomId },
      data: { yjsState: Buffer.from(state) },
    });
  }
}
