/**
 * Destination policy — allowlisting of rooms and DM recipients.
 *
 * Rules:
 *   - Rooms: an EMPTY room allowlist means ALLOW-ANY joined room; a non-empty
 *     allowlist restricts to rooms whose id OR name is listed.
 *   - DMs: gated by the master `allowDm` switch. When DM is enabled, an EMPTY
 *     recipient allowlist means ALLOW-ANY recipient; a non-empty allowlist
 *     restricts DMs to exactly those usernames.
 *   - No wildcards, no arrays, no ambiguous auto-selection.
 *
 * NOTE: with empty allowlists the agent can reach any joined room / any DM
 * recipient. Populate the allowlists to enforce least-privilege.
 */
import { AppError } from '../errors.js';
import type { AppConfig } from '../config/schema.js';

export interface RoomIdentity {
  id: string;
  name: string;
}

export class DestinationPolicy {
  private readonly allowedRoomIds: Set<string>;
  private readonly allowedRoomNames: Set<string>;
  private readonly allowDm: boolean;
  private readonly allowedDmUsers: Set<string>;

  constructor(config: Pick<AppConfig, 'allowedRooms' | 'allowDm' | 'allowedDmUsers'>) {
    // A given allowlist entry may be either a room id or a room name; we index
    // both spaces. Names are matched case-insensitively (Rocket.Chat treats
    // channel names case-insensitively); ids are matched exactly.
    this.allowedRoomIds = new Set(config.allowedRooms);
    this.allowedRoomNames = new Set(config.allowedRooms.map((r) => r.toLowerCase()));
    this.allowDm = config.allowDm;
    this.allowedDmUsers = new Set(config.allowedDmUsers);
  }

  isRoomAllowed(room: RoomIdentity): boolean {
    // Empty room allowlist = allow any joined room (mirrors the DM allowlist).
    if (this.allowedRoomIds.size === 0) return true;
    return this.allowedRoomIds.has(room.id) || this.allowedRoomNames.has(room.name.toLowerCase());
  }

  isDmAllowed(username: string): boolean {
    if (!this.allowDm) return false;
    // Empty DM allowlist = allow any recipient once DM is enabled.
    // A non-empty allowlist restricts to exactly those usernames.
    if (this.allowedDmUsers.size === 0) return true;
    return this.allowedDmUsers.has(username);
  }

  /** Throw `destination_not_allowed` if the room is not on the allowlist. */
  assertRoomAllowed(room: RoomIdentity): void {
    if (!this.isRoomAllowed(room)) {
      throw new AppError(
        'destination_not_allowed',
        'The target room is not on the destination allowlist.',
        { retryable: false, details: { room: room.name } },
      );
    }
  }

  /** Throw `destination_not_allowed` if DMs are disabled or the recipient is not allowed. */
  assertDmAllowed(username: string): void {
    if (!this.allowDm) {
      throw new AppError('destination_not_allowed', 'Direct messages are disabled by policy.', {
        retryable: false,
      });
    }
    // Empty allowlist allows any recipient; only enforce membership when set.
    if (this.allowedDmUsers.size > 0 && !this.allowedDmUsers.has(username)) {
      throw new AppError(
        'destination_not_allowed',
        'This recipient is not on the direct-message allowlist.',
        { retryable: false, details: { username } },
      );
    }
  }
}
