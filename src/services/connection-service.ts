/**
 * Connection service — verifies credentials and returns a safe identity.
 */
import type { RocketChatClient } from '../rocketchat/client.js';

export interface ConnectionResult {
  connected: true;
  baseUrl: string;
  user: {
    id: string;
    username: string;
  };
}

export class ConnectionService {
  constructor(private readonly client: RocketChatClient) {}

  /**
   * Call an authenticated read-only endpoint to confirm the URL/credentials work.
   * Returns only the bot's id and username — never token, roles or emails.
   */
  async testConnection(): Promise<ConnectionResult> {
    const me = await this.client.me();
    return {
      connected: true,
      baseUrl: this.client.baseUrl,
      user: {
        id: me._id,
        username: me.username,
      },
    };
  }
}
