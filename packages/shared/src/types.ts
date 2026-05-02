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
