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

/** Max chat message length. Enforced client-side (engine) and bounds WS payload size. */
export const MAX_MESSAGE_LENGTH = 4000;

// const object instead of enum — avoids dual-package hazard in ESM/CJS contexts
export const WsMsgType = {
  SYNC: 0,
  AWARENESS: 1,
} as const;
export type WsMsgType = typeof WsMsgType[keyof typeof WsMsgType];

export interface PresenceState {
  userId: string;
  username: string;
  roomId: string;
  isTyping: boolean;
  lastSeen: number;
}
