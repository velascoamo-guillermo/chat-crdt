export interface UserDto {
  id: string;
  username: string;
  email: string;
}

export interface MessageDto {
  /** ULID or UUIDv7 recommended for CRDT ordering tie-break */
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  /** Unix ms. Use id as tie-break when two messages share the same timestamp. */
  createdAt: number;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

/**
 * Max chat message length, in characters — enforced client-side (engine) on
 * the PLAINTEXT, before any E2EE encryption (ADR-010: sendMessage's own
 * MAX_MESSAGE_LENGTH check runs on `trimmed`, unchanged). No longer a tight
 * bound on wire size for an E2EE message: the post-encryption envelope
 * (base64 nonce/ciphertext + JSON framing) runs larger than the plaintext it
 * wraps — worst case (4000 mostly-multi-byte characters) lands around 16 KB,
 * still well under sync.gateway.ts's 64 KB MAX_WS_MESSAGE_BYTES frame limit.
 */
export const MAX_MESSAGE_LENGTH = 4000;

// const object instead of enum — avoids dual-package hazard in ESM/CJS contexts
export const WsMsgType = {
  SYNC: 0,
  AWARENESS: 1,
  /**
   * T10, server -> client: the client's sync update was rejected because it
   * inserts non-E2E1 messages into an E2EE room. Payload: varUint keyId,
   * varUint count, then `count` varString message ids. The server follows it
   * with a sync step1 so the client can resend everything else.
   */
  E2EE_REJECTED: 20,
  /** T10, server -> client: the room is E2EE at this epoch. Payload: varUint keyId. */
  ROOM_EPOCH: 21,
} as const;
export type WsMsgType = typeof WsMsgType[keyof typeof WsMsgType];

export interface PresenceState {
  userId: string;
  username: string;
  roomId: string;
  isTyping: boolean;
  lastSeen: number;
}
