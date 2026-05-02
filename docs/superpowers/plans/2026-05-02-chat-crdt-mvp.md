# Chat CRDT MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an offline-first real-time chat app with CRDT-based message sync, JWT auth, and presence — single room MVP.

**Architecture:** Expo mobile app uses Yjs Y.Array as the message CRDT, persisted to SQLite via op-sqlite. A custom WebSocket provider syncs with a NestJS server that maintains a server-side Y.Doc per room, fans out via Redis pub/sub for multi-instance support, and persists messages to PostgreSQL.

**Tech Stack:** Bun workspaces + Turborepo, Expo Router, FlashList, Yjs, op-sqlite, Zustand, NestJS, Prisma, Redis (ioredis), PostgreSQL, JWT

---

## File Map

```
chat-crdt/
  apps/
    mobile/                              # Expo Router app
      app/
        (auth)/
          login.tsx                      # Login screen
          register.tsx                   # Register screen
        (chat)/
          index.tsx                      # Chat screen (FlashList + input)
        _layout.tsx                      # Root layout + auth gate
      src/
        store/
          auth.store.ts                  # Zustand: JWT token + user
          chat.store.ts                  # Zustand: messages array (derived from Yjs)
        hooks/
          useSync.ts                     # Initializes SyncEngine, subscribes to updates
          usePresence.ts                 # Typing indicator + online state
        components/
          MessageItem.tsx                # Single message row (memo'd)
          TypingIndicator.tsx            # Animated dots
          OnlineCount.tsx                # Online users badge
      package.json
    server/
      src/
        auth/
          auth.module.ts
          auth.controller.ts             # POST /auth/register, POST /auth/login
          auth.service.ts                # bcrypt + JWT sign
          jwt.strategy.ts                # Passport JWT strategy
          dto/
            register.dto.ts
            login.dto.ts
        sync/
          sync.module.ts
          sync.gateway.ts                # WS gateway — Yjs sync protocol
          room-state.ts                  # RoomState class (Y.Doc + clients Set)
        presence/
          presence.module.ts
          presence.gateway.ts            # Awareness protocol relay
          presence.service.ts            # Redis presence tracking
        prisma/
          prisma.module.ts
          prisma.service.ts
          schema.prisma
      package.json
  packages/
    sync-engine/                         # Extractable npm package
      src/
        SyncEngine.ts                    # Main class: Y.Doc + Y.Array<Message>
        SQLitePersistence.ts             # op-sqlite Yjs persistence adapter
        WebSocketProvider.ts             # RN WebSocket + offline queue + backoff
        types.ts                         # Message, SyncEngineConfig interfaces
        index.ts                         # Public API
      package.json
    shared/
      src/
        types.ts                         # Shared: WsMessageType enum, UserDto, MessageDto
      package.json
  infra/
    docker-compose.yml                   # postgres + redis
  package.json                           # bun workspaces
  turbo.json
  tsconfig.base.json
  docs/
    adr/
      001-yjs-over-automerge.md
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `infra/docker-compose.yml`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "chat-crdt",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "lint": "turbo lint"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "target": "ES2022",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: chatcrdt
      POSTGRES_USER: chatcrdt
      POSTGRES_PASSWORD: chatcrdt
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

- [ ] **Step 5: Start infra**

```bash
docker compose -f infra/docker-compose.yml up -d
```

Expected: postgres and redis containers running.

- [ ] **Step 6: Install root deps**

```bash
bun install
```

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "chore: monorepo scaffold with turbo + docker infra"
```

---

## Task 2: Shared types package

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@chat-crdt/shared",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "CommonJS"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create types.ts**

```typescript
export interface UserDto {
  id: string;
  username: string;
  email: string;
}

export interface MessageDto {
  id: string;
  userId: string;
  username: string;
  content: string;
  createdAt: number; // unix ms
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

export enum WsMsgType {
  SYNC = 0,
  AWARENESS = 1,
}

export interface PresenceState {
  userId: string;
  username: string;
  isTyping: boolean;
  lastSeen: number;
}
```

- [ ] **Step 4: Create index.ts**

```typescript
export * from './types';
```

- [ ] **Step 5: Build**

```bash
cd packages/shared && bun run build
```

Expected: `dist/` generated with no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add shared types package"
```

---

## Task 3: NestJS server scaffold

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/main.ts`
- Create: `apps/server/src/app.module.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@chat-crdt/server",
  "version": "0.0.1",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "test": "jest"
  },
  "dependencies": {
    "@chat-crdt/shared": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/platform-ws": "^11.0.0",
    "@nestjs/websockets": "^11.0.0",
    "@nestjs/jwt": "^11.0.0",
    "@nestjs/passport": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "passport": "^0.7.0",
    "passport-jwt": "^4.0.1",
    "bcrypt": "^5.1.1",
    "ioredis": "^5.6.0",
    "yjs": "^13.6.27",
    "y-protocols": "^1.0.6",
    "lib0": "^0.2.109",
    "reflect-metadata": "^0.2.0",
    "rxjs": "^7.8.2"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/bcrypt": "^5.0.2",
    "@types/passport-jwt": "^4.0.1",
    "@types/ws": "^8.18.0",
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "CommonJS",
    "outDir": "dist",
    "rootDir": "src",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "target": "ES2021"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create src/main.ts**

```typescript
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableCors();
  await app.listen(process.env.PORT ?? 3001);
  console.log('Server running on port 3001');
}

bootstrap();
```

- [ ] **Step 4: Create src/app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Create .env**

```env
DATABASE_URL="postgresql://chatcrdt:chatcrdt@localhost:5432/chatcrdt"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="dev-secret-change-in-prod"
PORT=3001
```

- [ ] **Step 6: Install deps**

```bash
cd apps/server && bun install
```

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): nestjs scaffold"
```

---

## Task 4: Prisma schema + migrations

**Files:**
- Create: `apps/server/src/prisma/prisma.service.ts`
- Create: `apps/server/src/prisma/prisma.module.ts`
- Create: `apps/server/prisma/schema.prisma`

- [ ] **Step 1: Init Prisma**

```bash
cd apps/server && bunx prisma init --datasource-provider postgresql
```

- [ ] **Step 2: Write schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String    @id @default(uuid())
  email     String    @unique
  username  String    @unique
  password  String
  createdAt DateTime  @default(now())
  messages  Message[]
}

model Room {
  id        String    @id @default(uuid())
  name      String    @unique
  createdAt DateTime  @default(now())
  messages  Message[]
  yjsState  Bytes?
}

model Message {
  id        String   @id @default(uuid())
  content   String
  createdAt DateTime @default(now())
  userId    String
  roomId    String
  user      User     @relation(fields: [userId], references: [id])
  room      Room     @relation(fields: [roomId], references: [id])
}
```

- [ ] **Step 3: Run migration**

```bash
cd apps/server && bunx prisma migrate dev --name init
```

Expected: Migration applied, Prisma client generated.

- [ ] **Step 4: Create prisma.service.ts**

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit() {
    await this.$connect();
  }
}
```

- [ ] **Step 5: Create prisma.module.ts**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6: Add PrismaModule to AppModule**

Edit `apps/server/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: Commit**

```bash
git add apps/server/prisma apps/server/src/prisma
git commit -m "feat(server): prisma schema with User, Room, Message models"
```

---

## Task 5: Auth module (register + login)

**Files:**
- Create: `apps/server/src/auth/dto/register.dto.ts`
- Create: `apps/server/src/auth/dto/login.dto.ts`
- Create: `apps/server/src/auth/jwt.strategy.ts`
- Create: `apps/server/src/auth/auth.service.ts`
- Create: `apps/server/src/auth/auth.controller.ts`
- Create: `apps/server/src/auth/auth.module.ts`
- Create: `apps/server/src/auth/auth.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/server/src/auth/auth.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('token') } },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('register hashes password and returns token', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'uuid-1', email: 'a@b.com', username: 'alice', password: 'hash',
    });
    const result = await service.register({ email: 'a@b.com', username: 'alice', password: 'plain' });
    expect(result.token).toBe('token');
    expect(result.user.email).toBe('a@b.com');
  });

  it('login throws on wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uuid-1', email: 'a@b.com', username: 'alice', password: '$2b$10$invalid',
    });
    await expect(service.login({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow('Invalid credentials');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd apps/server && bun test src/auth/auth.service.spec.ts
```

Expected: FAIL — `AuthService` not found.

- [ ] **Step 3: Create DTOs**

`src/auth/dto/register.dto.ts`:
```typescript
export class RegisterDto {
  email: string;
  username: string;
  password: string;
}
```

`src/auth/dto/login.dto.ts`:
```typescript
export class LoginDto {
  email: string;
  password: string;
}
```

- [ ] **Step 4: Create auth.service.ts**

```typescript
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AuthResponse } from '@chat-crdt/shared';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email already in use');

    const password = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { email: dto.email, username: dto.username, password },
    });

    const token = this.jwt.sign({ sub: user.id, username: user.username });
    return { token, user: { id: user.id, email: user.email, username: user.username } };
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.jwt.sign({ sub: user.id, username: user.username });
    return { token, user: { id: user.id, email: user.email, username: user.username } };
  }
}
```

- [ ] **Step 5: Create jwt.strategy.ts**

```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  validate(payload: { sub: string; username: string }) {
    return { userId: payload.sub, username: payload.username };
  }
}
```

- [ ] **Step 6: Create auth.controller.ts**

```typescript
import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }
}
```

- [ ] **Step 7: Create auth.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
```

- [ ] **Step 8: Add AuthModule to AppModule**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 9: Run tests — expect PASS**

```bash
cd apps/server && bun test src/auth/auth.service.spec.ts
```

Expected: 2 passing.

- [ ] **Step 10: Smoke test auth endpoints**

```bash
cd apps/server && bun run dev
# in another terminal:
curl -s -X POST http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@test.com","username":"testuser","password":"secret123"}' | jq .
```

Expected: `{ "token": "...", "user": { "id": "...", "email": "test@test.com", ... } }`

- [ ] **Step 11: Commit**

```bash
git add apps/server/src/auth
git commit -m "feat(server): JWT auth — register + login"
```

---

## Task 6: WebSocket sync gateway (Yjs protocol)

**Files:**
- Create: `apps/server/src/sync/room-state.ts`
- Create: `apps/server/src/sync/sync.gateway.ts`
- Create: `apps/server/src/sync/sync.module.ts`

- [ ] **Step 1: Create room-state.ts**

```typescript
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { WebSocket } from 'ws';
import { MessageDto } from '@chat-crdt/shared';

export class RoomState {
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  clients: Set<WebSocket> = new Set();

  constructor(public readonly roomId: string) {
    this.doc = new Y.Doc();
    this.awareness = new awarenessProtocol.Awareness(this.doc);
  }

  getMessages(): MessageDto[] {
    return this.doc.getArray<MessageDto>('messages').toArray();
  }
}
```

- [ ] **Step 2: Create sync.gateway.ts**

```typescript
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, WebSocket, RawData } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { IncomingMessage } from 'http';
import { RoomState } from './room-state';
import { PrismaService } from '../prisma/prisma.service';
import { MessageDto } from '@chat-crdt/shared';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { Inject } from '@nestjs/common';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

@WebSocketGateway({ path: '/sync' })
export class SyncGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private rooms = new Map<string, RoomState>();
  private clientRoom = new WeakMap<WebSocket, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject('REDIS_PUB') private readonly pub: Redis,
    @Inject('REDIS_SUB') private readonly sub: Redis,
  ) {
    this.sub.psubscribe('room:*');
    this.sub.on('pmessage', (_pattern, channel, message) => {
      const roomId = channel.replace('room:update:', '');
      const room = this.rooms.get(roomId);
      if (!room) return;

      const update = Buffer.from(message, 'base64');
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
    const url = new URL(req.url!, `http://localhost`);
    const roomId = url.searchParams.get('room') ?? 'default';
    const token = url.searchParams.get('token');

    // Validate JWT
    try {
      this.jwt.verify(token ?? '');
    } catch {
      client.close(4001, 'Unauthorized');
      return;
    }

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new RoomState(roomId);
      this.rooms.set(roomId, room);

      // Load persisted Yjs state from DB
      const dbRoom = await this.prisma.room.findUnique({ where: { name: roomId } });
      if (dbRoom?.yjsState) {
        Y.applyUpdate(room.doc, new Uint8Array(dbRoom.yjsState));
      } else {
        await this.prisma.room.upsert({
          where: { name: roomId },
          create: { name: roomId },
          update: {},
        });
      }

      // Persist updates from this room's doc
      room.doc.on('update', async (update: Uint8Array, origin: unknown) => {
        if (origin === 'redis') return;
        await this.prisma.room.update({
          where: { name: roomId },
          data: { yjsState: Buffer.from(Y.encodeStateAsUpdate(room!.doc)) },
        });
      });
    }

    room.clients.add(client);
    this.clientRoom.set(client, roomId);

    // Sync step 1: send state vector to client
    const enc1 = encoding.createEncoder();
    encoding.writeVarUint(enc1, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc1, room.doc);
    client.send(encoding.toUint8Array(enc1));

    // Also send current full state
    const enc2 = encoding.createEncoder();
    encoding.writeVarUint(enc2, MSG_SYNC);
    syncProtocol.writeSyncStep2(enc2, room.doc, Y.encodeStateVector(room.doc));
    client.send(encoding.toUint8Array(enc2));

    client.on('message', (data: RawData) => this.handleMessage(client, room!, data));
  }

  handleDisconnect(client: WebSocket) {
    const roomId = this.clientRoom.get(client);
    if (!roomId) return;
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.clients.delete(client);
    if (room.clients.size === 0) {
      // Keep room state in memory for a short time, then GC
      setTimeout(() => {
        if (room.clients.size === 0) this.rooms.delete(roomId);
      }, 30_000);
    }
  }

  private handleMessage(client: WebSocket, room: RoomState, data: RawData) {
    const decoder = decoding.createDecoder(new Uint8Array(data as Buffer));
    const msgType = decoding.readVarUint(decoder);

    if (msgType === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      const syncState = syncProtocol.readSyncMessage(decoder, encoder, room.doc, client);

      if (encoding.length(encoder) > 1) {
        client.send(encoding.toUint8Array(encoder));
      }

      // If an update was applied, broadcast via Redis to other instances
      if (syncState === 2 /* messageYjsUpdate */ || syncState === 1 /* syncStep2 */) {
        const update = Y.encodeStateAsUpdate(room.doc);
        this.pub.publish(
          `room:update:${room.roomId}`,
          Buffer.from(update).toString('base64'),
        );
      }
    } else if (msgType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(room.awareness, update, client);

      // Broadcast awareness to room clients
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_AWARENESS);
      encoding.writeVarUint8Array(enc, update);
      const msg = encoding.toUint8Array(enc);
      room.clients.forEach(c => {
        if (c !== client && c.readyState === WebSocket.OPEN) c.send(msg);
      });
    }
  }
}
```

- [ ] **Step 3: Create sync.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { SyncGateway } from './sync.gateway';

const redisFactory = (name: string) => ({
  provide: name,
  useFactory: () => {
    const Redis = require('ioredis');
    return new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  },
});

@Module({
  providers: [
    SyncGateway,
    redisFactory('REDIS_PUB'),
    redisFactory('REDIS_SUB'),
  ],
})
export class SyncModule {}
```

- [ ] **Step 4: Add SyncModule to AppModule**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { SyncModule } from './sync/sync.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    SyncModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Smoke test WS connection**

```bash
cd apps/server && bun run dev
# in another terminal — install wscat globally if needed
npx wscat -c "ws://localhost:3001/sync?room=default&token=INVALID"
```

Expected: Connection closed with `4001 Unauthorized`.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/sync
git commit -m "feat(server): Yjs sync gateway with Redis fan-out"
```

---

## Task 7: sync-engine package

**Files:**
- Create: `packages/sync-engine/package.json`
- Create: `packages/sync-engine/tsconfig.json`
- Create: `packages/sync-engine/src/types.ts`
- Create: `packages/sync-engine/src/SyncEngine.ts`
- Create: `packages/sync-engine/src/WebSocketProvider.ts`
- Create: `packages/sync-engine/src/SQLitePersistence.ts`
- Create: `packages/sync-engine/src/index.ts`
- Create: `packages/sync-engine/src/SyncEngine.test.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@chat-crdt/sync-engine",
  "version": "0.0.1",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "bun test"
  },
  "dependencies": {
    "yjs": "^13.6.27",
    "y-protocols": "^1.0.6",
    "lib0": "^0.2.109",
    "@chat-crdt/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "module": "CommonJS"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write failing test**

Create `packages/sync-engine/src/SyncEngine.test.ts`:

```typescript
import { SyncEngine } from './SyncEngine';

describe('SyncEngine', () => {
  it('inserts a message into the Yjs array', () => {
    const engine = new SyncEngine({ roomId: 'test', userId: 'u1', username: 'alice' });
    engine.sendMessage('Hello');
    const messages = engine.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Hello');
    expect(messages[0].userId).toBe('u1');
  });

  it('CRDT merge: two engines with same roomId merge without duplicates', () => {
    const a = new SyncEngine({ roomId: 'room', userId: 'u1', username: 'alice' });
    const b = new SyncEngine({ roomId: 'room', userId: 'u2', username: 'bob' });

    a.sendMessage('from alice');
    b.sendMessage('from bob');

    // Exchange state vectors
    const updateA = a.encodeState();
    const updateB = b.encodeState();
    b.applyUpdate(updateA);
    a.applyUpdate(updateB);

    expect(a.getMessages()).toHaveLength(2);
    expect(b.getMessages()).toHaveLength(2);
    // Both see same messages (CRDT guarantee)
    expect(a.getMessages().map(m => m.content).sort())
      .toEqual(b.getMessages().map(m => m.content).sort());
  });
});
```

- [ ] **Step 4: Run test — expect FAIL**

```bash
cd packages/sync-engine && bun test
```

Expected: FAIL — `SyncEngine` not found.

- [ ] **Step 5: Create types.ts**

```typescript
export interface SyncEngineConfig {
  roomId: string;
  userId: string;
  username: string;
  wsUrl?: string;
  dbPath?: string;
}
```

- [ ] **Step 6: Create SyncEngine.ts**

```typescript
import * as Y from 'yjs';
import { MessageDto } from '@chat-crdt/shared';
import { SyncEngineConfig } from './types';

export class SyncEngine {
  readonly doc: Y.Doc;
  private messages: Y.Array<MessageDto>;
  private config: SyncEngineConfig;

  constructor(config: SyncEngineConfig) {
    this.config = config;
    this.doc = new Y.Doc();
    this.messages = this.doc.getArray<MessageDto>('messages');
  }

  sendMessage(content: string): MessageDto {
    const msg: MessageDto = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: this.config.userId,
      username: this.config.username,
      content,
      createdAt: Date.now(),
    };
    this.doc.transact(() => {
      this.messages.push([msg]);
    });
    return msg;
  }

  getMessages(): MessageDto[] {
    return this.messages.toArray();
  }

  subscribe(callback: (messages: MessageDto[]) => void): () => void {
    const handler = () => callback(this.getMessages());
    this.messages.observe(handler);
    return () => this.messages.unobserve(handler);
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc);
  }

  applyUpdate(update: Uint8Array, origin?: unknown): void {
    Y.applyUpdate(this.doc, update, origin);
  }

  encodeStateVector(): Uint8Array {
    return Y.encodeStateVector(this.doc);
  }

  encodeStateDiff(remoteStateVector: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc, remoteStateVector);
  }
}
```

- [ ] **Step 7: Run test — expect PASS**

```bash
cd packages/sync-engine && bun test
```

Expected: 2 passing.

- [ ] **Step 8: Commit**

```bash
git add packages/sync-engine/src/SyncEngine.ts packages/sync-engine/src/SyncEngine.test.ts packages/sync-engine/src/types.ts
git commit -m "feat(sync-engine): SyncEngine CRDT core with Y.Array messages"
```

---

## Task 8: WebSocket provider (RN-compatible, offline queue)

**Files:**
- Create: `packages/sync-engine/src/WebSocketProvider.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/sync-engine/src/WebSocketProvider.test.ts`:

```typescript
import { WebSocketProvider } from './WebSocketProvider';
import { SyncEngine } from './SyncEngine';

describe('WebSocketProvider offline queue', () => {
  it('queues updates when not connected and flushes on connect', async () => {
    const engine = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const sent: Uint8Array[] = [];

    const provider = new WebSocketProvider(engine, {
      url: 'ws://localhost:9999',
      token: 'tok',
      onSend: (data) => sent.push(data),
    });

    // Simulate offline — queue a message
    engine.sendMessage('queued message');
    expect(sent).toHaveLength(0); // not connected yet

    // Simulate connect
    provider.simulateConnect();
    expect(sent.length).toBeGreaterThan(0); // flushed
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/sync-engine && bun test src/WebSocketProvider.test.ts
```

- [ ] **Step 3: Create WebSocketProvider.ts**

```typescript
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SyncEngine } from './SyncEngine';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

type ProviderStatus = 'disconnected' | 'connecting' | 'connected';

interface WebSocketProviderConfig {
  url: string;
  token: string;
  onStatusChange?: (status: ProviderStatus) => void;
  onSend?: (data: Uint8Array) => void; // test hook
}

export class WebSocketProvider {
  private ws: WebSocket | null = null;
  private status: ProviderStatus = 'disconnected';
  private pendingUpdates: Uint8Array[] = [];
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private destroyed = false;
  readonly awareness: awarenessProtocol.Awareness;
  private testOnSend?: (data: Uint8Array) => void;

  constructor(
    private readonly engine: SyncEngine,
    private readonly config: WebSocketProviderConfig,
  ) {
    this.awareness = new awarenessProtocol.Awareness(engine.doc);
    this.testOnSend = config.onSend;

    // Queue local doc updates when offline
    engine.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return; // skip updates from remote
      if (this.status === 'connected') {
        this.sendUpdate(update);
      } else {
        this.pendingUpdates.push(update);
      }
    });

    if (!config.onSend) {
      // Real mode — connect immediately
      this.connect();
    }
  }

  // Test helper to simulate a connected state
  simulateConnect() {
    this.status = 'connected';
    this.flush();
  }

  private connect() {
    if (this.destroyed) return;
    this.setStatus('connecting');

    const url = `${this.config.url}?token=${this.config.token}`;
    this.ws = new WebSocket(url) as unknown as WebSocket;

    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.retryCount = 0;
      this.setStatus('connected');
      this.sendSyncStep1();
      this.flush();
    };

    this.ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      this.handleMessage(new Uint8Array(event.data));
    };

    this.ws.onclose = () => {
      if (!this.destroyed) {
        this.setStatus('disconnected');
        this.scheduleRetry();
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private sendSyncStep1() {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.engine.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private handleMessage(data: Uint8Array) {
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    if (msgType === MSG_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.engine.doc, this);
      if (encoding.length(encoder) > 1) {
        this.send(encoding.toUint8Array(encoder));
      }
    } else if (msgType === MSG_AWARENESS) {
      const update = decoding.readVarUint8Array(decoder);
      awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this);
    }
  }

  private sendUpdate(update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private flush() {
    const pending = [...this.pendingUpdates];
    this.pendingUpdates = [];
    pending.forEach(update => this.sendUpdate(update));
  }

  private send(data: Uint8Array) {
    if (this.testOnSend) {
      this.testOnSend(data);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private scheduleRetry() {
    const delay = Math.min(1000 * 2 ** this.retryCount, 30_000);
    this.retryCount++;
    this.retryTimeout = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: ProviderStatus) {
    this.status = status;
    this.config.onStatusChange?.(status);
  }

  sendAwareness(state: Partial<{ isTyping: boolean }>) {
    this.awareness.setLocalStateField('isTyping', state.isTyping ?? false);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.engine.doc.clientID]);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  destroy() {
    this.destroyed = true;
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.awareness.destroy();
    this.ws?.close();
  }

  getStatus(): ProviderStatus {
    return this.status;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd packages/sync-engine && bun test
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/sync-engine/src/WebSocketProvider.ts packages/sync-engine/src/WebSocketProvider.test.ts
git commit -m "feat(sync-engine): WebSocket provider with offline queue and exponential backoff"
```

---

## Task 9: SQLite persistence adapter

**Files:**
- Create: `packages/sync-engine/src/SQLitePersistence.ts`

> Note: `SQLitePersistence` uses `@op-engineering/op-sqlite` which is only available in React Native. The interface is written so it can be swapped for an in-memory adapter in tests.

- [ ] **Step 1: Create the interface + in-memory implementation for tests**

Create `packages/sync-engine/src/SQLitePersistence.ts`:

```typescript
import * as Y from 'yjs';
import { SyncEngine } from './SyncEngine';

export interface IStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// In-memory storage — used in tests and when op-sqlite is unavailable
export class MemoryStorage implements IStorage {
  private store = new Map<string, string>();
  async getItem(key: string) { return this.store.get(key) ?? null; }
  async setItem(key: string, value: string) { this.store.set(key, value); }
}

export class SQLitePersistence {
  private readonly key: string;
  private loaded = false;

  constructor(
    private readonly engine: SyncEngine,
    private readonly storage: IStorage,
  ) {
    this.key = `yjs:${engine.doc.guid}`;
  }

  async load(): Promise<void> {
    const raw = await this.storage.getItem(this.key);
    if (raw) {
      const update = Uint8Array.from(atob(raw).split('').map(c => c.charCodeAt(0)));
      Y.applyUpdate(this.engine.doc, update);
    }
    this.loaded = true;

    this.engine.doc.on('update', (_update: Uint8Array) => {
      const state = this.engine.encodeState();
      const b64 = btoa(String.fromCharCode(...state));
      this.storage.setItem(this.key, b64);
    });
  }

  isLoaded() { return this.loaded; }
}
```

- [ ] **Step 2: Write and run test**

Create `packages/sync-engine/src/SQLitePersistence.test.ts`:

```typescript
import { SyncEngine } from './SyncEngine';
import { SQLitePersistence, MemoryStorage } from './SQLitePersistence';

describe('SQLitePersistence', () => {
  it('persists and restores messages across engine instances', async () => {
    const storage = new MemoryStorage();

    const engine1 = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence1 = new SQLitePersistence(engine1, storage);
    await persistence1.load();

    engine1.sendMessage('persisted message');

    // New engine loads from same storage
    const engine2 = new SyncEngine({ roomId: 'r1', userId: 'u1', username: 'alice' });
    const persistence2 = new SQLitePersistence(engine2, storage);
    await persistence2.load();

    expect(engine2.getMessages()).toHaveLength(1);
    expect(engine2.getMessages()[0].content).toBe('persisted message');
  });
});
```

```bash
cd packages/sync-engine && bun test src/SQLitePersistence.test.ts
```

Expected: 1 passing.

- [ ] **Step 3: Create op-sqlite adapter (used at runtime in RN)**

Create `packages/sync-engine/src/OPSQLiteStorage.ts`:

```typescript
import { IStorage } from './SQLitePersistence';

// Adapter for @op-engineering/op-sqlite
// Imported at runtime in the React Native app — do NOT import in tests
export function createOPSQLiteStorage(db: {
  executeAsync: (sql: string, params?: unknown[]) => Promise<{ rows: { _array: { value: string }[] } }>;
}): IStorage {
  const init = db.executeAsync(
    `CREATE TABLE IF NOT EXISTS yjs_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`
  );

  return {
    async getItem(key: string) {
      await init;
      const result = await db.executeAsync(
        'SELECT value FROM yjs_kv WHERE key = ?', [key]
      );
      return result.rows._array[0]?.value ?? null;
    },
    async setItem(key: string, value: string) {
      await init;
      await db.executeAsync(
        'INSERT INTO yjs_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      );
    },
  };
}
```

- [ ] **Step 4: Export all from index.ts**

Create `packages/sync-engine/src/index.ts`:

```typescript
export { SyncEngine } from './SyncEngine';
export { WebSocketProvider } from './WebSocketProvider';
export { SQLitePersistence, MemoryStorage } from './SQLitePersistence';
export { createOPSQLiteStorage } from './OPSQLiteStorage';
export type { SyncEngineConfig } from './types';
export type { IStorage } from './SQLitePersistence';
```

- [ ] **Step 5: Build package**

```bash
cd packages/sync-engine && bun run build
```

Expected: `dist/` generated, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sync-engine/src
git commit -m "feat(sync-engine): SQLite persistence adapter + op-sqlite bridge"
```

---

## Task 10: Expo mobile app scaffold

**Files:**
- Create: `apps/mobile/` (Expo Router project)

- [ ] **Step 1: Create Expo app**

```bash
cd apps && bunx create-expo-app mobile --template tabs
```

- [ ] **Step 2: Install dependencies**

```bash
cd apps/mobile && bun add @shopify/flash-list @op-engineering/op-sqlite zustand expo-secure-store @chat-crdt/sync-engine@workspace:* @chat-crdt/shared@workspace:*
```

- [ ] **Step 3: Update package.json scripts**

Edit `apps/mobile/package.json`, replace scripts:

```json
"scripts": {
  "dev": "expo start",
  "android": "expo run:android",
  "ios": "expo run:ios",
  "build": "expo export"
}
```

- [ ] **Step 4: Configure metro for monorepo**

Edit `apps/mobile/metro.config.js`:

```javascript
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

module.exports = config;
```

- [ ] **Step 5: Configure op-sqlite in app.json**

Edit `apps/mobile/app.json`, add inside `"expo"`:

```json
"plugins": [
  ["@op-engineering/op-sqlite", {
    "sqliteFlags": "-DSQLITE_DQS=0"
  }]
]
```

- [ ] **Step 6: Verify app starts**

```bash
cd apps/mobile && bun run dev
```

Expected: Expo dev server starts on port 8081.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): expo app scaffold with FlashList, op-sqlite, zustand"
```

---

## Task 11: Auth store + screens

**Files:**
- Create: `apps/mobile/src/store/auth.store.ts`
- Create: `apps/mobile/app/(auth)/login.tsx`
- Create: `apps/mobile/app/(auth)/register.tsx`
- Create: `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Create auth store**

Create `apps/mobile/src/store/auth.store.ts`:

```typescript
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { UserDto, AuthResponse } from '@chat-crdt/shared';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
const TOKEN_KEY = 'auth_token';

interface AuthState {
  token: string | null;
  user: UserDto | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadFromStorage: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoading: true,

  loadFromStorage: async () => {
    const raw = await SecureStore.getItemAsync(TOKEN_KEY);
    if (raw) {
      const { token, user } = JSON.parse(raw) as AuthResponse;
      set({ token, user, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  login: async (email, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? 'Login failed');
    const data: AuthResponse = await res.json();
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(data));
    set({ token: data.token, user: data.user });
  },

  register: async (email, username, password) => {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });
    if (!res.ok) throw new Error((await res.json()).message ?? 'Register failed');
    const data: AuthResponse = await res.json();
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(data));
    set({ token: data.token, user: data.user });
  },

  logout: async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ token: null, user: null });
  },
}));
```

- [ ] **Step 2: Create root layout with auth gate**

Create `apps/mobile/app/_layout.tsx`:

```tsx
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../src/store/auth.store';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { token, isLoading, loadFromStorage } = useAuthStore();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => { loadFromStorage(); }, []);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!token && !inAuth) router.replace('/(auth)/login');
    if (token && inAuth) router.replace('/(chat)');
  }, [token, isLoading]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGate>
  );
}
```

- [ ] **Step 3: Create login screen**

Create `apps/mobile/app/(auth)/login.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore(s => s.login);
  const router = useRouter();

  const handleLogin = async () => {
    setLoading(true);
    try {
      await login(email, password);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Chat CRDT</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Login</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
        <Text style={styles.link}>No account? Register</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 32, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#0066ff', borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { textAlign: 'center', color: '#0066ff', marginTop: 8 },
});
```

- [ ] **Step 4: Create register screen**

Create `apps/mobile/app/(auth)/register.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/auth.store';

export default function RegisterScreen() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const register = useAuthStore(s => s.register);
  const router = useRouter();

  const handleRegister = async () => {
    setLoading(true);
    try {
      await register(email, username, password);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Username"
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <TouchableOpacity style={styles.button} onPress={handleRegister} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.back()}>
        <Text style={styles.link}>Already have an account? Login</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 32, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, marginBottom: 12, fontSize: 16 },
  button: { backgroundColor: '#0066ff', borderRadius: 8, padding: 14, alignItems: 'center', marginBottom: 12 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { textAlign: 'center', color: '#0066ff', marginTop: 8 },
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/store/auth.store.ts apps/mobile/app
git commit -m "feat(mobile): auth store + login/register screens"
```

---

## Task 12: Chat screen — FlashList + Yjs integration

**Files:**
- Create: `apps/mobile/src/store/chat.store.ts`
- Create: `apps/mobile/src/hooks/useSync.ts`
- Create: `apps/mobile/src/components/MessageItem.tsx`
- Create: `apps/mobile/app/(chat)/index.tsx`

- [ ] **Step 1: Create chat store**

Create `apps/mobile/src/store/chat.store.ts`:

```typescript
import { create } from 'zustand';
import { MessageDto } from '@chat-crdt/shared';

interface ChatState {
  messages: MessageDto[];
  wsStatus: 'disconnected' | 'connecting' | 'connected';
  setMessages: (messages: MessageDto[]) => void;
  setStatus: (status: ChatState['wsStatus']) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  wsStatus: 'disconnected',
  setMessages: (messages) => set({ messages }),
  setStatus: (wsStatus) => set({ wsStatus }),
}));
```

- [ ] **Step 2: Create useSync hook**

Create `apps/mobile/src/hooks/useSync.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { open } from '@op-engineering/op-sqlite';
import { SyncEngine, WebSocketProvider, SQLitePersistence, createOPSQLiteStorage } from '@chat-crdt/sync-engine';
import { useAuthStore } from '../store/auth.store';
import { useChatStore } from '../store/chat.store';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'ws://localhost:3001/sync';
const ROOM_ID = 'default';

export function useSync() {
  const token = useAuthStore(s => s.token);
  const user = useAuthStore(s => s.user);
  const { setMessages, setStatus } = useChatStore();

  const engineRef = useRef<SyncEngine | null>(null);
  const providerRef = useRef<WebSocketProvider | null>(null);

  useEffect(() => {
    if (!token || !user) return;

    const db = open({ name: 'chat.db' });
    const storage = createOPSQLiteStorage(db);

    const engine = new SyncEngine({
      roomId: ROOM_ID,
      userId: user.id,
      username: user.username,
    });
    engineRef.current = engine;

    const persistence = new SQLitePersistence(engine, storage);

    persistence.load().then(() => {
      setMessages(engine.getMessages());

      const unsub = engine.subscribe((msgs) => setMessages(msgs));

      const provider = new WebSocketProvider(engine, {
        url: `${WS_URL}?room=${ROOM_ID}`,
        token,
        onStatusChange: setStatus,
      });
      providerRef.current = provider;

      return () => {
        unsub();
        provider.destroy();
      };
    });

    return () => {
      providerRef.current?.destroy();
    };
  }, [token, user]);

  const sendMessage = (content: string) => {
    engineRef.current?.sendMessage(content);
  };

  const sendTyping = (isTyping: boolean) => {
    providerRef.current?.sendAwareness({ isTyping });
  };

  return { sendMessage, sendTyping };
}
```

- [ ] **Step 3: Create MessageItem component**

Create `apps/mobile/src/components/MessageItem.tsx`:

```tsx
import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MessageDto } from '@chat-crdt/shared';
import { useAuthStore } from '../store/auth.store';

interface Props {
  message: MessageDto;
}

export const MessageItem = memo(function MessageItem({ message }: Props) {
  const userId = useAuthStore(s => s.user?.id);
  const isOwn = message.userId === userId;

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {!isOwn && <Text style={styles.username}>{message.username}</Text>}
      <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
        <Text style={[styles.content, isOwn && styles.contentOwn]}>{message.content}</Text>
      </View>
      <Text style={styles.time}>
        {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { marginVertical: 4, marginHorizontal: 12, alignItems: 'flex-start' },
  rowOwn: { alignItems: 'flex-end' },
  username: { fontSize: 11, color: '#888', marginBottom: 2, marginLeft: 4 },
  bubble: { maxWidth: '75%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleOwn: { backgroundColor: '#0066ff', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#f0f0f0', borderBottomLeftRadius: 4 },
  content: { fontSize: 15, color: '#111' },
  contentOwn: { color: '#fff' },
  time: { fontSize: 10, color: '#aaa', marginTop: 2, marginHorizontal: 4 },
});
```

- [ ] **Step 4: Create chat screen**

Create `apps/mobile/app/(chat)/index.tsx`:

```tsx
import { useState, useCallback, useRef } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useChatStore } from '../../src/store/chat.store';
import { useSync } from '../../src/hooks/useSync';
import { MessageItem } from '../../src/components/MessageItem';
import { MessageDto } from '@chat-crdt/shared';
import { useAuthStore } from '../../src/store/auth.store';

export default function ChatScreen() {
  const [input, setInput] = useState('');
  const messages = useChatStore(s => s.messages);
  const wsStatus = useChatStore(s => s.wsStatus);
  const { sendMessage, sendTyping } = useSync();
  const listRef = useRef<FlashList<MessageDto>>(null);
  const logout = useAuthStore(s => s.logout);

  const handleSend = useCallback(() => {
    const content = input.trim();
    if (!content) return;
    sendMessage(content);
    setInput('');
    sendTyping(false);
  }, [input, sendMessage, sendTyping]);

  const handleChangeText = useCallback((text: string) => {
    setInput(text);
    sendTyping(text.length > 0);
  }, [sendTyping]);

  const statusColor = wsStatus === 'connected' ? '#22c55e' : wsStatus === 'connecting' ? '#f59e0b' : '#ef4444';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <Text style={styles.roomName}># general</Text>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <TouchableOpacity onPress={logout}>
            <Text style={styles.logout}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlashList
        ref={listRef}
        data={messages}
        renderItem={({ item }) => <MessageItem message={item} />}
        keyExtractor={item => item.id}
        estimatedItemSize={60}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={styles.listContent}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={handleChangeText}
          placeholder="Message..."
          multiline
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={!input.trim()}>
          <Text style={styles.sendText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee', paddingTop: 56 },
  roomName: { fontSize: 18, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  logout: { color: '#888', fontSize: 14 },
  listContent: { paddingVertical: 8 },
  inputRow: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#eee', alignItems: 'flex-end', gap: 8 },
  textInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  sendButton: { backgroundColor: '#0066ff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: '#fff', fontWeight: '600' },
});
```

- [ ] **Step 5: Add (chat) layout file**

Create `apps/mobile/app/(chat)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function ChatLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src apps/mobile/app
git commit -m "feat(mobile): chat screen with FlashList + Yjs sync integration"
```

---

## Task 13: Presence UI — typing indicators + online count

**Files:**
- Create: `apps/mobile/src/hooks/usePresence.ts`
- Create: `apps/mobile/src/components/TypingIndicator.tsx`
- Modify: `apps/mobile/src/hooks/useSync.ts`
- Modify: `apps/mobile/app/(chat)/index.tsx`

- [ ] **Step 1: Expose awareness from useSync**

Edit `apps/mobile/src/hooks/useSync.ts` — add to return value and store ref:

```typescript
// Add to return object:
const getAwareness = () => providerRef.current?.awareness ?? null;
return { sendMessage, sendTyping, getAwareness };
```

- [ ] **Step 2: Create usePresence hook**

Create `apps/mobile/src/hooks/usePresence.ts`:

```typescript
import { useState, useEffect } from 'react';
import * as awarenessProtocol from 'y-protocols/awareness';
import { PresenceState } from '@chat-crdt/shared';

export function usePresence(awareness: awarenessProtocol.Awareness | null) {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);

  useEffect(() => {
    if (!awareness) return;

    const handler = () => {
      const states = Array.from(awareness.getStates().values()) as Partial<PresenceState>[];
      setOnlineCount(states.length);
      setTypingUsers(
        states
          .filter(s => s.isTyping && s.username)
          .map(s => s.username!)
      );
    };

    awareness.on('change', handler);
    handler();
    return () => awareness.off('change', handler);
  }, [awareness]);

  return { typingUsers, onlineCount };
}
```

- [ ] **Step 3: Create TypingIndicator component**

Create `apps/mobile/src/components/TypingIndicator.tsx`:

```tsx
import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  typingUsers: string[];
}

export const TypingIndicator = memo(function TypingIndicator({ typingUsers }: Props) {
  if (typingUsers.length === 0) return null;

  const label =
    typingUsers.length === 1
      ? `${typingUsers[0]} is typing...`
      : `${typingUsers.slice(0, 2).join(', ')} are typing...`;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 4 },
  text: { fontSize: 12, color: '#888', fontStyle: 'italic' },
});
```

- [ ] **Step 4: Wire into ChatScreen**

Edit `apps/mobile/app/(chat)/index.tsx` — add below imports:

```tsx
import { usePresence } from '../../src/hooks/usePresence';
import { TypingIndicator } from '../../src/components/TypingIndicator';
```

Inside `ChatScreen`:
```tsx
const { sendMessage, sendTyping, getAwareness } = useSync();
const { typingUsers, onlineCount } = usePresence(getAwareness());
```

Add `onlineCount` to header and `TypingIndicator` above input row:

```tsx
// In header, replace statusRow:
<View style={styles.statusRow}>
  <View style={[styles.dot, { backgroundColor: statusColor }]} />
  <Text style={styles.onlineText}>{onlineCount} online</Text>
  <TouchableOpacity onPress={logout}>
    <Text style={styles.logout}>Logout</Text>
  </TouchableOpacity>
</View>

// Between FlashList and inputRow:
<TypingIndicator typingUsers={typingUsers} />
```

Add to styles:
```tsx
onlineText: { fontSize: 12, color: '#888' },
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/hooks/usePresence.ts apps/mobile/src/components/TypingIndicator.tsx apps/mobile/src/hooks/useSync.ts apps/mobile/app/(chat)/index.tsx
git commit -m "feat(mobile): presence UI — typing indicators + online count"
```

---

## Task 14: ADR + README

**Files:**
- Create: `docs/adr/001-yjs-over-automerge.md`
- Modify: `README.md`

- [ ] **Step 1: Write ADR**

Create `docs/adr/001-yjs-over-automerge.md`:

```markdown
# ADR 001: Yjs over Automerge for message list CRDT

**Status:** Accepted

**Context:**
The message list needs CRDT semantics for offline-first sync. The two main candidates are Yjs and Automerge.

**Decision:** Yjs

**Reasons:**
- Battle-tested in production (used by TipTap, Liveblocks, etc.)
- y-protocols provides the WebSocket sync protocol out of the box
- y-indexeddb and awareness protocol already solved for browser; easy to adapt for RN
- Smaller bundle size than Automerge (~60KB vs ~400KB)
- Automerge-repo sync protocol is newer and less documented

**Trade-offs:**
- Automerge has more principled CRDT semantics (full history, time-travel)
- Yjs has some edge cases with large document history — mitigated by periodic snapshots
- If we need edit-history per message in future, Automerge would be reconsidered
```

- [ ] **Step 2: Create root README.md**

```markdown
# chat-crdt

Offline-first real-time chat with CRDT sync. Single-room MVP.

## Stack

- **Mobile:** Expo Router, FlashList, Yjs, op-sqlite, Zustand
- **Server:** NestJS, Yjs, Redis pub/sub, PostgreSQL, Prisma
- **Sync:** `@chat-crdt/sync-engine` — Yjs wrapper, extractable npm package

## Quick start

```bash
docker compose -f infra/docker-compose.yml up -d
bun install
cd apps/server && bun run dev
cd apps/mobile && bun run dev
```

## Architecture

See `docs/adr/` for architecture decisions.
See `docs/superpowers/plans/` for implementation plan.
```

- [ ] **Step 3: Commit**

```bash
git add docs/adr README.md
git commit -m "docs: ADR 001 Yjs vs Automerge + README"
```

---

## Task 15: Integration smoke test

> Manual test covering the full offline → sync scenario.

- [ ] **Step 1: Start infra + server**

```bash
docker compose -f infra/docker-compose.yml up -d
cd apps/server && bun run dev
```

- [ ] **Step 2: Start mobile on two simulators**

```bash
cd apps/mobile && bun run ios
# Open a second iOS simulator and run expo start again
```

- [ ] **Step 3: Register two users**

Register `alice@test.com / alice` and `bob@test.com / bob` on each simulator.

- [ ] **Step 4: Verify real-time sync**

Alice sends "hello from alice" — verify it appears on Bob's screen within 1 second.

- [ ] **Step 5: Test offline mode**

On Alice's simulator: Settings → Network → Toggle airplane mode ON.
Alice sends 3 messages.
Verify messages appear locally with optimistic state.

- [ ] **Step 6: Reconnect and verify merge**

Toggle airplane mode OFF on Alice's simulator.
Verify Alice's 3 messages appear on Bob's screen.
Verify message order is consistent on both sides.

- [ ] **Step 7: Test typing indicator**

Alice starts typing — verify Bob sees "alice is typing..." within 500ms.
Alice stops typing — verify indicator disappears within 3 seconds.

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "chore: mvp complete — chat-crdt single room with offline sync"
```
