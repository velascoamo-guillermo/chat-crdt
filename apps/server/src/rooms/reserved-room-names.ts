/**
 * Room names that collide with the mobile client's static Expo Router routes
 * under `apps/mobile/app/(chat)/` (`rooms.tsx`, `account.tsx`). If a room
 * were ever created with one of these names, the client could never
 * navigate to it — a static route always wins over the dynamic `[roomId]`
 * route for the same path segment.
 *
 * 'default' is included too even though room creation is already blocked
 * for it indirectly (RoomsService.create() conflicts on the existing row) —
 * listed here so the full reserved set lives in one place instead of two
 * enforcement paths silently agreeing by coincidence.
 *
 * Single source of truth for both the DTO validator (create-room.dto.ts)
 * and any future server-side check that needs the same set.
 */
export const RESERVED_ROOM_NAMES = ['rooms', 'account', 'default'] as const;
