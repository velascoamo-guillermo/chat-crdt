import * as Y from 'yjs';
import { SyncEngine } from './SyncEngine';

export interface IStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** In-memory IStorage for tests and SSR */
export class MemoryStorage implements IStorage {
  private readonly store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Loop instead of spread to avoid call-stack overflow on large documents
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class SQLitePersistence {
  // Storage key uses roomId (stable across restarts) not doc.guid (random per instance)
  private readonly key: string;
  private loaded = false;
  private destroyed = false;
  private readonly docUpdateHandler: () => void;

  constructor(
    private readonly engine: SyncEngine,
    private readonly storage: IStorage,
  ) {
    this.key = `yjs:${engine.roomId}`;
    this.docUpdateHandler = () => {
      const state = engine.encodeState();
      storage.setItem(this.key, uint8ToBase64(state)).catch(() => {
        // persist errors are non-fatal — next write will retry
      });
    };
  }

  async load(): Promise<void> {
    if (this.loaded) return; // idempotent
    const raw = await this.storage.getItem(this.key);
    if (this.destroyed) return; // component unmounted during async read
    if (raw) {
      Y.applyUpdate(this.engine.doc, base64ToUint8(raw));
    }
    // Subscribe AFTER loading to avoid persisting the initial hydration
    this.engine.doc.on('update', this.docUpdateHandler);
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  destroy(): void {
    this.destroyed = true;
    this.engine.doc.off('update', this.docUpdateHandler);
  }
}
