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

export class SQLitePersistence {
  private readonly key: string;
  private loaded = false;
  private readonly docUpdateHandler: () => void;

  constructor(
    private readonly engine: SyncEngine,
    private readonly storage: IStorage,
  ) {
    this.key = `yjs:${engine.roomId}`;
    this.docUpdateHandler = () => {
      const state = engine.encodeState();
      // base64 encode for text storage
      const b64 = btoa(String.fromCharCode(...state));
      storage.setItem(this.key, b64).catch(() => {
        // persist errors are non-fatal — next write will retry
      });
    };
  }

  async load(): Promise<void> {
    const raw = await this.storage.getItem(this.key);
    if (raw) {
      const binary = atob(raw);
      const update = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        update[i] = binary.charCodeAt(i);
      }
      Y.applyUpdate(this.engine.doc, update);
    }
    // Subscribe to future updates AFTER loading to avoid persisting the initial load
    this.engine.doc.on('update', this.docUpdateHandler);
    this.loaded = true;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  destroy(): void {
    this.engine.doc.off('update', this.docUpdateHandler);
  }
}
