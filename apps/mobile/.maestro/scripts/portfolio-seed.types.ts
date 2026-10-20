/**
 * Shape of the portfolio-video seed content (T8). The content itself lives in
 * portfolio-seed.data.ts (written separately, fictional people only); the
 * provisioning logic lives in seed-portfolio.ts.
 */

/** Which recording device a user is logged in on / a line is typed from. */
export type DeviceRole = "ios" | "android";

export interface PortfolioUser {
  /** Must use a reserved domain (example.com) — never a real mailbox. */
  email: string;
  /** Display name shown above bubbles; 2–30 chars (RegisterDto). */
  username: string;
  /** ≥ 8 chars (RegisterDto). Local demo server only. */
  password: string;
}

export interface ScriptLine {
  from: DeviceRole;
  /** One chat message; keep ≤ 60 chars so it types fast on camera. */
  text: string;
}

export type ClipId =
  | "01-compose"
  | "02-two-authors"
  | "03-offline-merge"
  | "04-e2ee";

export interface PortfolioClip {
  id: ClipId;
  /** Room name: /^[a-z0-9-]+$/, 2–64 chars, not "default". */
  room: string;
  /** Room is E2EE-enabled on camera prep (from the iOS admin device). */
  e2ee: boolean;
  /**
   * Messages seeded before recording (headless sync-engine, plaintext).
   * Must be empty for 01-compose (empty room) and 04-e2ee (encrypted rooms
   * can't be seeded headlessly — device-bound identity keys).
   */
  history: ScriptLine[];
  /** Messages typed on-device while recording, in order. */
  live: ScriptLine[];
  /** 03-offline-merge only: lines each side sends while the server is down. */
  offline?: Record<DeviceRole, string[]>;
}

export interface PortfolioSeed {
  users: Record<DeviceRole, PortfolioUser>;
  clips: PortfolioClip[];
  /** Extra empty rooms so the rooms list looks lived-in. Same name rules. */
  extraRooms: string[];
}
