/**
 * Room naming, in one place.
 *
 * Rooms are the entire authorisation model of a socket connection: what a
 * client is in determines what it can see, and nothing else does. That makes
 * the naming worth centralising — a typo'd room string does not error, it
 * silently delivers to nobody, or worse, to a room somebody else is in.
 */
export const Rooms = {
  /** Everything addressed to one person: notifications, their own events. */
  user: (userId: string): string => `user:${userId}`,

  /** One order's live feed — status changes and the rider's position. */
  order: (orderId: string): string => `order:${orderId}`,

  /** A kitchen's incoming tickets. */
  restaurant: (restaurantId: string): string => `restaurant:${restaurantId}`,

  /** One rider's own channel: offers, assignment changes. */
  rider: (driverId: string): string => `rider:${driverId}`,

  /** The operations dispatch board. Staff only. */
  dispatch: (): string => 'dispatch',
} as const;

export type RoomKind = 'user' | 'order' | 'restaurant' | 'rider' | 'dispatch';

export interface ParsedRoom {
  kind: RoomKind;
  id: string | null;
}

/** Reads a room name back into its parts, for logging and presence counts. */
export function parseRoom(room: string): ParsedRoom | null {
  if (room === 'dispatch') {
    return { kind: 'dispatch', id: null };
  }

  const [kind, id] = room.split(':');

  if (id === undefined || id === '') {
    return null;
  }

  switch (kind) {
    case 'user':
    case 'order':
    case 'restaurant':
    case 'rider':
      return { kind, id };
    default:
      return null;
  }
}
