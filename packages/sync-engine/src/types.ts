import { ContentCipher } from './ContentCipher';

export interface SyncEngineConfig {
  roomId: string;
  userId: string;
  username: string;
  /** ADR-010: absent = room isn't E2EE-enabled, or a test with no cipher. */
  contentCipher?: ContentCipher;
}
