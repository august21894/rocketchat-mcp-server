/**
 * Target resolver — turn a tool-supplied target into a concrete destination.
 *
 * Resolution is driven by the bot's subscriptions (so the bot must have joined
 * the room) plus user autocomplete for DM recipients. It prefers the internal
 * room id so downstream code can enforce the allowlist, detect E2EE, validate
 * thread parents and (when possible) use `chat.sendMessage` with a stable id.
 *
 * Ambiguous names are an error — we never auto-pick the first match.
 */
import { AppError } from '../errors.js';
import type { NormalizedRoomType } from '../rocketchat/types.js';
import type { RoomInfo, RoomService } from './room-service.js';
import type { UserService } from './user-service.js';

export type TargetType = 'channel' | 'private_room' | 'user' | 'room_id';

export interface Target {
  type: TargetType;
  value: string;
}

export interface ResolvedDestination {
  type: NormalizedRoomType;
  /** Human-facing name (channel name or recipient username). */
  name: string;
  /** Friendly display name, when Rocket.Chat provides one. */
  displayName?: string;
  /** Resolved room id, when known. Absent for a not-yet-created DM. */
  roomId?: string;
  encrypted: boolean;
  /** For direct messages, the recipient username. */
  recipientUsername?: string;
  /** True when a room id is known and `chat.sendMessage` can be used. */
  canUseSendMessage: boolean;
}

export class TargetResolver {
  constructor(
    private readonly rooms: RoomService,
    private readonly users: UserService,
  ) {}

  async resolve(target: Target): Promise<ResolvedDestination> {
    switch (target.type) {
      case 'room_id':
        return this.resolveByRoomId(target.value);
      case 'channel':
        return this.resolveByName(target.value, 'channel');
      case 'private_room':
        return this.resolveByNameOrId(target.value, 'private_room');
      case 'user':
        return this.resolveUser(target.value);
      default: {
        const exhaustive: never = target.type;
        throw new AppError('invalid_input', `Unsupported target type: ${String(exhaustive)}.`);
      }
    }
  }

  private fromRoom(room: RoomInfo): ResolvedDestination {
    const dest: ResolvedDestination = {
      type: room.type,
      name: room.name,
      roomId: room.id,
      encrypted: room.encrypted,
      canUseSendMessage: true,
    };
    if (room.recipientUsername !== undefined) {
      dest.recipientUsername = room.recipientUsername;
    }
    if (room.displayName !== undefined) {
      dest.displayName = room.displayName;
    }
    return dest;
  }

  private async resolveByRoomId(rid: string): Promise<ResolvedDestination> {
    const subs = await this.rooms.listSubscriptions();
    const match = subs.find((r) => r.id === rid);
    if (!match) {
      throw new AppError('destination_not_found', 'No joined room matches that room id.', {
        details: { roomId: rid },
      });
    }
    return this.fromRoom(match);
  }

  private async resolveByName(
    name: string,
    type: NormalizedRoomType,
  ): Promise<ResolvedDestination> {
    const subs = await this.rooms.listSubscriptions();
    const target = name.toLowerCase();
    const matches = subs.filter((r) => r.type === type && r.name.toLowerCase() === target);
    return this.pickSingle(matches, name, type);
  }

  private async resolveByNameOrId(
    value: string,
    type: NormalizedRoomType,
  ): Promise<ResolvedDestination> {
    const subs = await this.rooms.listSubscriptions();
    // Exact id match wins unambiguously.
    const byId = subs.find((r) => r.type === type && r.id === value);
    if (byId) return this.fromRoom(byId);

    const target = value.toLowerCase();
    const matches = subs.filter((r) => r.type === type && r.name.toLowerCase() === target);
    return this.pickSingle(matches, value, type);
  }

  private pickSingle(
    matches: RoomInfo[],
    value: string,
    type: NormalizedRoomType,
  ): ResolvedDestination {
    if (matches.length === 0) {
      throw new AppError('destination_not_found', `No joined ${type} named "${value}".`, {
        details: { value, type },
      });
    }
    if (matches.length > 1) {
      throw new AppError(
        'ambiguous_destination',
        `Multiple ${type} rooms match "${value}"; refusing to auto-select.`,
        { details: { value, type, count: matches.length } },
      );
    }
    return this.fromRoom(matches[0]!);
  }

  private async resolveUser(username: string): Promise<ResolvedDestination> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      throw new AppError('destination_not_found', `No user found with username "${username}".`, {
        details: { username },
      });
    }

    // Reuse an existing DM subscription (gives us a room id + E2EE flag).
    const subs = await this.rooms.listSubscriptions();
    const dm = subs.find(
      (r) =>
        r.type === 'direct' && r.recipientUsername?.toLowerCase() === user.username.toLowerCase(),
    );

    if (dm) {
      const dest: ResolvedDestination = {
        type: 'direct',
        name: user.username,
        roomId: dm.id,
        encrypted: dm.encrypted,
        recipientUsername: user.username,
        canUseSendMessage: true,
      };
      if (user.name !== undefined) dest.displayName = user.name;
      return dest;
    }

    // No DM room yet: it will be created on send via chat.postMessage("@user").
    const dest: ResolvedDestination = {
      type: 'direct',
      name: user.username,
      encrypted: false,
      recipientUsername: user.username,
      canUseSendMessage: false,
    };
    if (user.name !== undefined) dest.displayName = user.name;
    return dest;
  }
}
