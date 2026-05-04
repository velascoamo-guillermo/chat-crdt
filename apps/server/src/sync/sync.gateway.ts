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
import { RoomState } from './room-state';
import { randomUUID } from 'crypto';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const ROOM_GC_DELAY_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 5_000;

interface RedisPayload {
  origin: string;
  update: string; // base64 incremental update
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject('REDIS_PUB') private readonly pub: Redis,
    @Inject('REDIS_SUB') private readonly sub: Redis,
  ) {}

  onModuleInit() {
    this.sub.psubscribe('room:update:*');
    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const payload: RedisPayload = JSON.parse(message);

      // Skip updates originated by this instance — clients already received them inline
      if (payload.origin === this.instanceId) return;

      const roomId = channel.replace('room:update:', '');
      const room = this.rooms.get(roomId);
      if (!room) return;

      const update = Buffer.from(payload.update, 'base64');
      // Apply to server doc so it stays in sync with other instances
      Y.applyUpdate(room.doc, update, 'redis');

      // Fan out to local clients
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const msg = encoding.toUint8Array(encoder);

      room.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });
    });
  }

  async handleConnection(client: WebSocket, req: IncomingMessage) {
    const url = new URL(req.url!, 'http://localhost');
    const roomId = url.searchParams.get('room') ?? 'default';
    const token = url.searchParams.get('token') ?? '';

    try {
      this.jwt.verify(token);
    } catch {
      client.close(4001, 'Unauthorized');
      return;
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
    syncProtocol.writeSyncStep2(enc2, room.doc, new Uint8Array());
    client.send(encoding.toUint8Array(enc2));

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
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        const syncState = syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);

        if (encoding.length(encoder) > 1) {
          client.send(encoding.toUint8Array(encoder));
        }

        // Broadcast incremental updates from clients to other server instances
        // syncState 1 = syncStep2 (client sending us its diff), 2 = update
        if (syncState === 1 || syncState === 2) {
          // Capture the incremental update that was just applied
          const update = Y.encodeStateAsUpdate(room.doc);
          const payload: RedisPayload = {
            origin: this.instanceId,
            update: Buffer.from(update).toString('base64'),
          };
          this.pub.publish(`room:update:${room.roomId}`, JSON.stringify(payload));
          this.schedulePersist(room);
        }
      } else if (msgType === MSG_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);

        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, update);
        const msg = encoding.toUint8Array(enc);
        room.clients.forEach(c => {
          if (c !== client && c.readyState === WebSocket.OPEN) c.send(msg);
        });
      }
    } catch (err: any) {
      this.logger.error(`Error handling message: ${err.message}`);
    }
  }

  private getOrCreateRoom(roomId: string): Promise<RoomState> {
    let p = this.roomInitMap.get(roomId);
    if (!p) {
      const room = new RoomState(roomId);
      this.rooms.set(roomId, room);
      p = this.loadRoomState(room).then(() => room);
      this.roomInitMap.set(roomId, p);
    }
    return p;
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
