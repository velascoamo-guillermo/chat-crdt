import { Redirect } from "expo-router";

// Preserves the single-room-MVP landing behavior: logging in lands straight
// in the 'default' room's chat screen (the Maestro suite — apps/mobile/.maestro
// — asserts on this immediately after login), even though multi-room support
// added a dedicated room list at /(chat)/rooms. 'default' is the server's
// open lobby (see apps/server/src/sync/sync.gateway.ts) — every authenticated
// user can enter it with no explicit join, so redirecting here needs no
// membership check.
export default function ChatIndex() {
  return <Redirect href="/(chat)/default" />;
}
