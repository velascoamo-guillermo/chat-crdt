// When the empty-room greeting may show. `messages.length === 0` alone can't
// tell an empty room from one whose local history hasn't loaded yet (store
// returns [] until persistence.load() resolves, and clearRoom wipes it on every
// engine rebuild), so the greeting flashed on re-entry into populated rooms.
// While not connected, an empty local copy may just be a device without history.
export function showEmptyRoom(s: { loaded: boolean; messageCount: number; wsStatus: string }): boolean {
  return s.loaded && s.messageCount === 0 && s.wsStatus === 'connected';
}
