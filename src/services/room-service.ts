/**
 * Room service — reads the bot's subscriptions and exposes normalized rooms.
 *
 * Room discovery is driven by `subscriptions.get`, so a room only appears if the
 * bot has actually joined it. Types are normalized (c/p/d → channel/private_room/
 * direct) and results are filtered through the destination policy.
 */
import {
  ROOM_TYPE_MAP,
  type NormalizedRoomType,
  type RcSubscription,
} from '../rocketchat/types.js';
import type { RocketChatClient } from '../rocketchat/client.js';
import type { DestinationPolicy } from '../policies/destination-policy.js';

export interface RoomInfo {
  id: string;
  /** Canonical name used for addressing/allowlisting (channel slug / username). */
  name: string;
  /** Friendly display name, when different from `name`. */
  displayName?: string;
  type: NormalizedRoomType;
  encrypted: boolean;
  /** For direct rooms, the other participant's username. */
  recipientUsername?: string;
}

function toRoomInfo(sub: RcSubscription): RoomInfo {
  const info: RoomInfo = {
    id: sub.rid,
    name: sub.name,
    type: ROOM_TYPE_MAP[sub.t],
    encrypted: sub.encrypted === true,
  };
  if (sub.fname !== undefined && sub.fname !== sub.name) {
    info.displayName = sub.fname;
  }
  if (sub.t === 'd') {
    // For DMs the subscription name is the other user's username.
    info.recipientUsername = sub.name;
  }
  return info;
}

export interface ListRoomsFilter {
  types?: NormalizedRoomType[];
  query?: string;
  limit: number;
}

export class RoomService {
  constructor(
    private readonly client: RocketChatClient,
    private readonly policy: DestinationPolicy,
  ) {}

  /** All subscriptions mapped to {@link RoomInfo} (unfiltered). */
  async listSubscriptions(): Promise<RoomInfo[]> {
    const subs = await this.client.subscriptionsGet();
    return subs.map(toRoomInfo);
  }

  /**
   * List rooms visible to the agent: type-filtered, name-filtered, and screened
   * by the destination policy (allowed rooms, or allowed DM recipients).
   */
  async listRooms(filter: ListRoomsFilter): Promise<RoomInfo[]> {
    const all = await this.listSubscriptions();
    const typeSet = filter.types ? new Set(filter.types) : null;
    const q = filter.query?.toLowerCase();

    const visible = all.filter((room) => {
      if (typeSet && !typeSet.has(room.type)) return false;
      if (q) {
        const haystack = `${room.name} ${room.displayName ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (room.type === 'direct') {
        return room.recipientUsername ? this.policy.isDmAllowed(room.recipientUsername) : false;
      }
      return this.policy.isRoomAllowed({ id: room.id, name: room.name });
    });

    return visible.slice(0, filter.limit);
  }
}
