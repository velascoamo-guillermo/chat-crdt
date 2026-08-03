/**
 * A bench WS client that speaks the *real* sync protocol used by
 * apps/server/src/sync/sync.gateway.ts and packages/sync-engine/src/WebSocketProvider.ts:
 * JWT auth via the `Sec-WebSocket-Protocol: bearer, <jwt>` subprotocol, then a
 * y-protocols sync handshake against a real Y.Doc. Transport is RawWsSocket
 * (see raw-ws-socket.ts) rather than Bun's native `WebSocket` — Bun's client
 * throws `SyntaxError: Mismatch client protocol` on this exact two-element
 * subprotocol offer, so a minimal RFC 6455 client over `node:net` is used
 * instead. See raw-ws-socket.ts header comment for the full explanation.
 *
 * Publishers push a small JSON payload (see latency-payload.ts) into the
 * shared `messages` Y.Array; subscribers observe array growth and report a
 * latency sample per new entry via `observeLatencies`.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { encodeTimestampedPayload, decodeTimestampedPayload } from './latency-payload';
import { RawWsSocket } from './raw-ws-socket';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

export interface LatencySample {
  seq: number;
  sentAt: number;
  receivedAt: number;
}

export interface WsBenchClientConfig {
  url: string;
  token: string;
  /** ms to wait for the initial server sync frame before giving up. */
  readyTimeoutMs?: number;
  /**
   * Optional in-process artificial-delay wrapper (documented option, not a
   * first-class scenario — see run.ts header comment / amendment 5): delays
   * every outgoing frame from this client by this many ms, standing in for
   * `tc`/toxiproxy-style added network latency without needing root or Linux.
   */
  artificialDelayMs?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 10_000;

export class WsBenchClient {
  readonly doc: Y.Doc;
  private readonly messages: Y.Array<string>;
  private socket: RawWsSocket | null = null;
  private lastObservedLength = 0;
  private readyResolved = false;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  readonly ready: Promise<void>;
  private closed = false;
  private closeCode: number | null = null;

  constructor(private readonly config: WsBenchClientConfig) {
    this.doc = new Y.Doc();
    this.messages = this.doc.getArray<string>('messages');
    this.lastObservedLength = this.messages.length;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    // Mirrors WebSocketProvider's docUpdateHandler: local mutations (origin
    // undefined, e.g. from publish()) get sent to the server; updates that
    // arrived FROM the server (applied with origin `this` in the message
    // handler) must not be echoed back.
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      this.sendUpdate(update);
    });
  }

  connect(): void {
    const timeoutMs = this.config.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

    RawWsSocket.connect(this.config.url, ['bearer', this.config.token], timeoutMs)
      .then(socket => {
        if (this.closed) {
          socket.close();
          return;
        }
        this.socket = socket;

        socket.on({
          onMessage: data => this.handleMessage(data),
          onClose: (code, _reason) => {
            this.closed = true;
            this.closeCode = code;
            if (!this.readyResolved) {
              this.rejectReady(new Error(`WS closed before handshake completed (code ${code})`));
            }
          },
          onError: err => {
            if (!this.readyResolved) this.rejectReady(err);
          },
        });

        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeSyncStep1(encoder, this.doc);
        this.send(encoding.toUint8Array(encoder));
      })
      .catch(err => {
        if (!this.readyResolved) this.rejectReady(err);
      });
  }

  private handleMessage(data: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(data);
      const msgType = decoding.readVarUint(decoder);

      if (msgType === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
        if (encoding.length(encoder) > 1) {
          this.send(encoding.toUint8Array(encoder));
        }
        if (!this.readyResolved) {
          this.readyResolved = true;
          this.resolveReady();
        }
      } else if (msgType === MSG_AWARENESS) {
        // Bench doesn't exercise awareness/presence — drain the frame and ignore.
        decoding.readVarUint8Array(decoder);
      }
    } catch (err) {
      // Surface the failure instead of silently dropping the connection —
      // a malformed/unexpected frame during a bench run should be loud.
      console.error(`[WsBenchClient] message-handling error on ${this.config.url}:`, err);
    }
  }

  private sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  /** Applies the optional artificial-delay wrapper before handing a frame to the socket. */
  private send(data: Uint8Array): void {
    const delay = this.config.artificialDelayMs ?? 0;
    if (delay <= 0) {
      this.socket?.send(data);
      return;
    }
    setTimeout(() => {
      if (!this.closed) this.socket?.send(data);
    }, delay);
  }

  isClosed(): boolean {
    return this.closed;
  }

  lastCloseCode(): number | null {
    return this.closeCode;
  }

  /** Publisher role: append a timestamped entry to the shared messages array. */
  publish(seq: number): void {
    if (this.closed) throw new Error(`publish(${seq}) called on a closed WS bench client`);
    this.messages.push([encodeTimestampedPayload(seq, Date.now())]);
  }

  /** Subscriber role: fire `onSample` once per newly-observed remote entry. */
  observeLatencies(onSample: (sample: LatencySample) => void): () => void {
    const handler = () => {
      const receivedAt = Date.now();
      const arr = this.messages.toArray();
      for (let i = this.lastObservedLength; i < arr.length; i++) {
        try {
          const { seq, sentAt } = decodeTimestampedPayload(arr[i]);
          onSample({ seq, sentAt, receivedAt });
        } catch {
          // Skip malformed/foreign entries rather than crash the whole run.
        }
      }
      this.lastObservedLength = arr.length;
    };
    this.messages.observe(handler);
    return () => this.messages.unobserve(handler);
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
    this.doc.destroy();
  }
}
