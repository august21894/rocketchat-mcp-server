/**
 * Test helpers for building a valid AppConfig from a base environment.
 */
import { loadConfig } from '../../src/config/env.js';
import type { AppConfig } from '../../src/config/schema.js';

export const TEST_TOKEN = 'super-secret-token-abcdef123456';

export function makeEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ROCKETCHAT_BASE_URL: 'https://chat.example.com',
    ROCKETCHAT_USER_ID: 'bot-user-id',
    ROCKETCHAT_AUTH_TOKEN: TEST_TOKEN,
    ROCKETCHAT_ALLOWED_ROOMS: 'general,engineering',
    ROCKETCHAT_ALLOW_DM: 'true',
    ROCKETCHAT_ALLOWED_DM_USERS: 'alice',
    ROCKETCHAT_ALLOW_HERE_MENTION: 'false',
    ROCKETCHAT_ALLOW_ALL_MENTION: 'false',
    LOG_LEVEL: 'error',
    ...overrides,
  };
}

export function makeConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig(makeEnv(overrides));
}
