# Chat CRDT — Diagrams

---

## 1 — Use Cases

```mermaid
graph LR
    subgraph Actors
        U["👤 User"]
        SYS["🖥️ System"]
    end

    subgraph "Auth"
        UC1["Register account"]
        UC2["Login"]
        UC3["Logout"]
        UC4["Persist session<br/>(SecureStore)"]
    end

    subgraph "Chat"
        UC5["Send message"]
        UC6["Receive message<br/>(real-time)"]
        UC7["View history<br/>(on load)"]
        UC8["Send while offline<br/>(queue)"]
        UC9["Auto-sync<br/>on reconnect"]
        UC10["CRDT merge<br/>(no conflict visible)"]
    end

    subgraph "Presence"
        UC11["See typing indicator"]
        UC12["See online count"]
        UC13["Broadcast typing state"]
    end

    U --> UC1
    U --> UC2
    U --> UC3
    U --> UC5
    U --> UC6
    U --> UC7
    U --> UC8
    U --> UC13

    UC2 --> UC4
    UC8 -->|"reconnect"| UC9
    UC9 --> UC10

    SYS --> UC4
    SYS --> UC9
    SYS --> UC10
    SYS --> UC11
    SYS --> UC12
```

---

## 2 — Component Architecture

```mermaid
graph TB
    subgraph "📱 Expo App (React Native)"
        direction TB
        UI["UI Layer<br/>FlashList · TextInput · Header"]
        AUTH_SCREEN["Auth Screens<br/>login.tsx · register.tsx"]
        CHAT_SCREEN["Chat Screen<br/>(chat)/index.tsx"]
        PRESENCE_UI["Presence UI<br/>TypingIndicator · OnlineCount"]

        subgraph "State (Zustand)"
            AUTH_STORE["useAuthStore<br/>token · user · isLoading"]
            CHAT_STORE["useChatStore<br/>messages · wsStatus"]
        end

        subgraph "Hooks"
            USE_SYNC["useSync()<br/>initiates SyncEngine + Provider"]
            USE_PRESENCE["usePresence(awareness)<br/>typingUsers · onlineCount"]
        end

        subgraph "@chat-crdt/sync-engine"
            SYNC_ENGINE["SyncEngine<br/>Y.Doc + Y.Array&lt;MessageDto&gt;"]
            WS_PROVIDER["WebSocketProvider<br/>offline queue · backoff · awareness"]
            SQLITE_PERSIST["SQLitePersistence<br/>load/save Yjs state"]
        end

        DB_SQLITE[("SQLite<br/>(op-sqlite)<br/>yjs_kv table")]
    end

    subgraph "🖥️ NestJS Server"
        AUTH_MODULE["AuthModule<br/>JWT register/login"]
        SYNC_GW["SyncGateway<br/>Y.Doc per room<br/>Redis fan-out"]
        PRISMA["PrismaService<br/>PostgreSQL"]
    end

    REDIS[("Redis 7<br/>pub/sub")]
    POSTGRES[("PostgreSQL 16<br/>User · Room · Message")]

    AUTH_SCREEN --> AUTH_STORE
    CHAT_SCREEN --> CHAT_STORE
    CHAT_SCREEN --> USE_SYNC
    CHAT_SCREEN --> USE_PRESENCE
    PRESENCE_UI --> USE_PRESENCE
    USE_SYNC --> SYNC_ENGINE
    USE_SYNC --> WS_PROVIDER
    USE_SYNC --> SQLITE_PERSIST
    SQLITE_PERSIST <--> DB_SQLITE
    SYNC_ENGINE --> CHAT_STORE
    WS_PROVIDER <-->|"WebSocket<br/>y-protocols binary"| SYNC_GW
    WS_PROVIDER --> USE_PRESENCE

    AUTH_SCREEN -->|"POST /auth/login<br/>POST /auth/register"| AUTH_MODULE
    AUTH_MODULE --> PRISMA
    SYNC_GW --> PRISMA
    SYNC_GW <--> REDIS
    PRISMA --> POSTGRES
```

---

## 3 — Tech Stack

```mermaid
graph TB
    subgraph "📱 Mobile"
        RN["React Native 0.76"]
        EXPO["Expo SDK 53"]
        EXPROUTER["Expo Router 4<br/>(file-based navigation)"]
        FLASHLIST["FlashList<br/>(@shopify/flash-list)<br/>performant list"]
        ZUSTAND["Zustand 5<br/>(client state)"]
        SECURESTORE["expo-secure-store<br/>(JWT storage)"]
        OPSQLITE["op-sqlite<br/>(@op-engineering/op-sqlite)<br/>(SQLite native)"]
    end

    subgraph "🔄 Sync Engine (@chat-crdt/sync-engine)"
        YJS["Yjs<br/>(CRDT Y.Array)"]
        YPROTO["y-protocols<br/>(sync + awareness protocol)"]
        LIB0["lib0<br/>(binary encoding)"]
        ULID["ulid<br/>(monotonic message IDs)"]
    end

    subgraph "🖥️ Server"
        NESTJS["NestJS 11<br/>(framework)"]
        WS["ws<br/>(WebSocket adapter)"]
        JWT["@nestjs/jwt<br/>passport-jwt<br/>(auth)"]
        IOREDIS["ioredis 5<br/>(Redis client)"]
        PRISMA_LIB["Prisma 5<br/>(ORM)"]
        BCRYPT["bcrypt<br/>(password hashing)"]
        CLASSVAL["class-validator<br/>class-transformer<br/>(DTO validation)"]
    end

    subgraph "🗄️ Infrastructure"
        PG["PostgreSQL 16<br/>(messages + rooms + users)"]
        REDIS2["Redis 7<br/>(pub/sub fan-out)"]
        DOCKER["Docker Compose<br/>(local dev)"]
        TURBO["Turborepo 2<br/>(monorepo build)"]
        BUN["Bun 1.2<br/>(package manager + runtime)"]
    end

    subgraph "📦 Shared"
        SHARED["@chat-crdt/shared<br/>TypeScript types<br/>(MessageDto · UserDto · PresenceState)"]
    end
```

---

## 4 — Online Message Flow

```mermaid
sequenceDiagram
    participant App as RN App
    participant Yjs as Yjs Doc
    participant DB as SQLite
    participant WS as WS Gateway
    participant Redis
    participant PG as PostgreSQL
    participant Other as Other client

    App->>Yjs: insert(message) — optimistic
    Yjs->>DB: persist Yjs state (SQLitePersistence)
    Yjs->>WS: send Yjs binary update (y-protocols)
    WS->>Redis: PUBLISH room:update:{roomId}
    WS->>PG: UPDATE Room.yjsState (debounced 5s)
    Redis-->>WS: fan-out to other instances
    WS-->>Other: broadcast Yjs update
    Other->>Yjs: Y.applyUpdate()
    Yjs-->>Other: re-render via subscribe()
    WS-->>App: ack (echo filtered by instanceId)
```

---

## 5 — Offline → Reconnect → CRDT Merge

```mermaid
sequenceDiagram
    participant App as RN App
    participant Yjs as Yjs Doc
    participant DB as SQLite
    participant Queue as Offline Queue
    participant WS as WS Gateway

    Note over App,WS: No connection
    App->>Yjs: insert(message) — optimistic
    Yjs->>DB: persist update locally
    Yjs--xQueue: WS unreachable → enqueue

    Note over App,WS: Reconnect (exponential backoff: 1s→2s→4s→...→30s)
    App->>WS: connect()
    WS-->>App: connected
    App->>WS: sync step 1 (state vector)
    WS-->>App: sync step 2 (server diff)
    App->>Yjs: Y.applyUpdate(serverDiff)
    Note over Yjs: CRDT auto-merge<br/>no visible conflict
    App->>WS: flush offline queue
    Yjs-->>App: re-render merged state
```

---

## 6 — Message State Machine

```mermaid
stateDiagram-v2
    [*] --> Pending: User sends
    Pending --> Sent: WS ack received
    Pending --> Queued: Offline detected
    Queued --> Sent: Reconnect + flush
    Sent --> Delivered: Other client receives
    Sent --> Merging: Concurrent updates
    Merging --> Delivered: Yjs auto-merge
    Delivered --> [*]
```

---

## 7 — Auth Flow

```mermaid
sequenceDiagram
    participant App as RN App
    participant SecureStore
    participant API as NestJS /auth

    App->>API: POST /auth/register {email, username, password}
    API-->>App: { token, user }
    App->>SecureStore: setItem('auth_token', JSON)

    Note over App: App restart
    App->>SecureStore: getItem('auth_token')
    SecureStore-->>App: { token, user }
    App->>App: set token → redirect to /(chat)

    App->>API: WS connect ?token=JWT
    API->>API: jwt.verify(token)
    alt valid
        API-->>App: connection accepted
    else invalid
        API-->>App: close(4001, 'Unauthorized')
    end
```

---

## 8 — Monorepo Package Graph

```mermaid
graph LR
    subgraph "apps/"
        MOBILE["@chat-crdt/mobile<br/>(Expo)"]
        SERVER["@chat-crdt/server<br/>(NestJS)"]
    end

    subgraph "packages/"
        SYNC["@chat-crdt/sync-engine<br/>(Yjs wrapper)"]
        SHARED["@chat-crdt/shared<br/>(TypeScript types)"]
    end

    MOBILE --> SYNC
    MOBILE --> SHARED
    SERVER --> SHARED
    SYNC --> SHARED
```
