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

/** Coalesce bursts of doc updates into a single write. */
const PERSIST_DEBOUNCE_MS = 500;

export class SQLitePersistence {
  // Storage key uses roomId (stable across restarts) not doc.guid (random per instance)
  private readonly key: string;
  private loaded = false;
  private destroyed = false;
  private readonly docUpdateHandler: () => void;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly engine: SyncEngine,
    private readonly storage: IStorage,
    private readonly debounceMs: number = PERSIST_DEBOUNCE_MS,
  ) {
    this.key = `yjs:${engine.roomId}`;
    // Debounce: a rapid burst of updates (e.g. initial sync) writes once.
    this.docUpdateHandler = () => {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.persist();
      }, this.debounceMs);
    };
  }

  private persist(): void {
    if (this.destroyed) return;
    const state = this.engine.encodeState();
    this.storage.setItem(this.key, uint8ToBase64(state)).catch(() => {
      // persist errors are non-fatal — next write will retry
    });
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
    this.engine.doc.off('update', this.docUpdateHandler);
    // Flush a pending debounced write so the last update isn't lost on unmount.
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      this.persist();
    }
    this.destroyed = true;
  }
}
