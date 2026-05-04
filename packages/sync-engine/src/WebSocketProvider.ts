import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { SyncEngine } from './SyncEngine';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MAX_RETRY_DELAY_MS = 30_000;
const BASE_RETRY_DELAY_MS = 1_000;

export type ProviderStatus = 'disconnected' | 'connecting' | 'connected';

export interface WebSocketProviderConfig {
  url: string;
  token: string;
  onStatusChange?: (status: ProviderStatus) => void;
  /** Test-only hook: intercepts outgoing binary messages instead of opening a real WebSocket */
  _testSend?: (data: Uint8Array) => void;
}

export class WebSocketProvider {
  private ws: WebSocket | null = null;
  private status: ProviderStatus = 'disconnected';
  private pendingUpdates: Uint8Array[] = [];
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private destroyed = false;
  private readonly docUpdateHandler: (update: Uint8Array, origin: unknown) => void;
  readonly awareness: awarenessProtocol.Awareness;

  constructor(
    private readonly engine: SyncEngine,
    private readonly config: WebSocketProviderConfig,
  ) {
    this.awareness = new awarenessProtocol.Awareness(engine.doc);

    this.docUpdateHandler = (update: Uint8Array, origin: unknown) => {
      if (this.destroyed) return;
      if (origin === this) return; // skip remote updates applied by us
      if (this.status === 'connected') {
        this.sendUpdate(update);
      } else {
        this.pendingUpdates.push(update);
      }
    };

    engine.doc.on('update', this.docUpdateHandler);

    // In test mode (_testSend provided), do NOT open a real WebSocket
    if (!config._testSend) {
      this.connect();
    }
  }

  /** Test-only: simulate a successful WebSocket connection and flush the queue */
  simulateConnect(): void {
    if (this.destroyed) return;
    this.setStatus('connected');
    this.flush();
  }

  private connect(): void {
    if (this.destroyed) return;
    this.setStatus('connecting');

    const url = `${this.config.url}?token=${this.config.token}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.retryCount = 0;
      this.setStatus('connected');
      this.sendSyncStep1();
      this.flush();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      let data: Uint8Array;
      if (typeof event.data === 'string') {
        // React Native may deliver binary as base64 string
        const binary = atob(event.data);
        data = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          data[i] = binary.charCodeAt(i);
        }
      } else {
        data = new Uint8Array(event.data as ArrayBuffer);
      }
      this.handleServerMessage(data);
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

  private sendSyncStep1(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.engine.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  private handleServerMessage(data: Uint8Array): void {
    try {
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
    } catch {
      // swallow malformed messages
    }
  }

  private sendUpdate(update: Uint8Array): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  private flush(): void {
    const pending = this.pendingUpdates.splice(0);
    for (const update of pending) {
      this.sendUpdate(update);
    }
  }

  private send(data: Uint8Array): void {
    if (this.config._testSend) {
      this.config._testSend(data);
      return;
    }
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private scheduleRetry(): void {
    const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** this.retryCount, MAX_RETRY_DELAY_MS);
    this.retryCount++;
    this.retryTimeout = setTimeout(() => this.connect(), delay);
  }

  private setStatus(status: ProviderStatus): void {
    this.status = status;
    this.config.onStatusChange?.(status);
  }

  sendAwareness(state: Partial<{ isTyping: boolean; username: string }>): void {
    if (this.destroyed) return;
    for (const [key, value] of Object.entries(state)) {
      this.awareness.setLocalStateField(key, value);
    }
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
      this.engine.doc.clientID,
    ]);
    encoding.writeVarUint8Array(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  }

  getStatus(): ProviderStatus {
    return this.status;
  }

  destroy(): void {
    this.destroyed = true;
    this.engine.doc.off('update', this.docUpdateHandler);
    this.awareness.destroy();
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.ws?.close();
    this.ws = null;
    this.pendingUpdates = [];
  }
}
