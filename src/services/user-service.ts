/**
 * User service — search users via `users.autocomplete` and resolve exact
 * usernames. Only safe, non-sensitive fields are ever exposed.
 */
import type { RocketChatClient } from '../rocketchat/client.js';

export interface SafeUser {
  id: string;
  username: string;
  name?: string;
  status?: string;
}

function toSafeUser(user: {
  _id: string;
  username: string;
  name?: string;
  status?: string;
}): SafeUser {
  const safe: SafeUser = { id: user._id, username: user.username };
  if (user.name !== undefined) safe.name = user.name;
  if (user.status !== undefined) safe.status = user.status;
  return safe;
}

export class UserService {
  constructor(private readonly client: RocketChatClient) {}

  /** Search users by term, returning at most `limit` safe records. */
  async searchUsers(query: string, limit: number): Promise<SafeUser[]> {
    const items = await this.client.usersAutocomplete(query);
    return items.slice(0, limit).map(toSafeUser);
  }

  /**
   * Resolve an exact username to a safe user, or `null` if no exact match is
   * found. Matching is case-insensitive on the username.
   */
  async findByUsername(username: string): Promise<SafeUser | null> {
    const items = await this.client.usersAutocomplete(username);
    const target = username.toLowerCase();
    const exact = items.find((u) => u.username?.toLowerCase() === target);
    return exact ? toSafeUser(exact) : null;
  }
}
