import { describe, expect, it } from 'vitest';
import {
  buildProfileEnvironment,
  parseProfileEnvironment,
  renderProfileEnvironment,
  serverNameForProfile,
  slugifyProfile,
} from '../../packages/create-rocketchat-mcp/src/profile.js';
import type { ProfileInput } from '../../packages/create-rocketchat-mcp/src/types.js';

function input(overrides: Partial<ProfileInput> = {}): ProfileInput {
  return {
    baseUrl: 'https://chat.example.com',
    userId: 'bot-id',
    authToken: 'secret-token',
    workspaceName: 'Facon',
    roomAccess: 'selected',
    selectedRoomIds: ['GENERAL', 'ENGINEERING'],
    dmAccess: 'disabled',
    selectedDmUsers: [],
    mentionPolicy: 'blocked',
    ...overrides,
  };
}

describe('initializer profile policy', () => {
  it('maps all joined rooms to an empty allowlist', () => {
    const env = buildProfileEnvironment(input({ roomAccess: 'all', selectedRoomIds: ['IGNORED'] }));
    expect(env.ROCKETCHAT_ALLOWED_ROOMS).toBe('');
  });

  it('stores stable selected room IDs and de-duplicates them', () => {
    const env = buildProfileEnvironment(
      input({ selectedRoomIds: ['GENERAL', 'GENERAL', ' ENGINEERING '] }),
    );
    expect(env.ROCKETCHAT_ALLOWED_ROOMS).toBe('GENERAL,ENGINEERING');
  });

  it('maps direct-message and mention choices explicitly', () => {
    const env = buildProfileEnvironment(
      input({
        dmAccess: 'selected',
        selectedDmUsers: ['alice', 'alice', 'bob'],
        mentionPolicy: 'here-only',
      }),
    );
    expect(env.ROCKETCHAT_ALLOW_DM).toBe('true');
    expect(env.ROCKETCHAT_ALLOWED_DM_USERS).toBe('alice,bob');
    expect(env.ROCKETCHAT_ALLOW_HERE_MENTION).toBe('true');
    expect(env.ROCKETCHAT_ALLOW_ALL_MENTION).toBe('false');
  });

  it('round-trips generated environment files without losing token characters', () => {
    const original = buildProfileEnvironment(
      input({ authToken: 'token=with"a-quote', roomAccess: 'all' }),
    );
    const parsed = parseProfileEnvironment(renderProfileEnvironment(original));
    expect(parsed).toEqual(original);
  });

  it('creates readable stable profile and server names', () => {
    expect(slugifyProfile('Nội Bộ Facon')).toBe('noi-bo-facon');
    expect(serverNameForProfile('Nội Bộ Facon')).toBe('rocketchat-noi-bo-facon');
  });
});
