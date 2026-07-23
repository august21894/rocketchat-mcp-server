import { describe, it, expect } from 'vitest';
import { TargetResolver } from '../../src/services/target-resolver.js';
import { RoomService } from '../../src/services/room-service.js';
import { UserService } from '../../src/services/user-service.js';
import { DestinationPolicy } from '../../src/policies/destination-policy.js';
import { makeFakeClient } from '../fixtures/fake-client.js';
import type { RcSubscription } from '../../src/rocketchat/types.js';

const SUBS: RcSubscription[] = [
  { _id: 's1', rid: 'GENERAL', name: 'general', t: 'c' },
  { _id: 's2', rid: 'PRIV1', name: 'secret', t: 'p' },
  { _id: 's3', rid: 'DM1', name: 'alice', t: 'd' },
  { _id: 's4', rid: 'ENC1', name: 'cryptoroom', t: 'p', encrypted: true },
];

function makeResolver(subs = SUBS) {
  const client = makeFakeClient({
    subscriptions: subs,
    autocomplete: [
      { _id: 'u1', username: 'alice', name: 'Alice' },
      { _id: 'u2', username: 'carol', name: 'Carol' },
    ],
  });
  const policy = new DestinationPolicy({ allowedRooms: [], allowDm: false, allowedDmUsers: [] });
  const rooms = new RoomService(client, policy);
  const users = new UserService(client);
  return new TargetResolver(rooms, users);
}

describe('TargetResolver', () => {
  it('resolves a public channel by name', async () => {
    const dest = await makeResolver().resolve({ type: 'channel', value: 'general' });
    expect(dest).toMatchObject({
      type: 'channel',
      name: 'general',
      roomId: 'GENERAL',
      canUseSendMessage: true,
    });
  });

  it('resolves a channel name case-insensitively', async () => {
    const dest = await makeResolver().resolve({ type: 'channel', value: 'GENERAL' });
    expect(dest.roomId).toBe('GENERAL');
  });

  it('errors when a channel is not joined', async () => {
    await expect(
      makeResolver().resolve({ type: 'channel', value: 'missing' }),
    ).rejects.toMatchObject({
      code: 'destination_not_found',
    });
  });

  it('resolves a private room by name and by id', async () => {
    const byName = await makeResolver().resolve({ type: 'private_room', value: 'secret' });
    expect(byName.roomId).toBe('PRIV1');
    const byId = await makeResolver().resolve({ type: 'private_room', value: 'PRIV1' });
    expect(byId.roomId).toBe('PRIV1');
  });

  it('resolves a room_id, including DMs', async () => {
    const dest = await makeResolver().resolve({ type: 'room_id', value: 'DM1' });
    expect(dest).toMatchObject({ type: 'direct', recipientUsername: 'alice', roomId: 'DM1' });
  });

  it('errors on an unknown room_id', async () => {
    await expect(makeResolver().resolve({ type: 'room_id', value: 'NOPE' })).rejects.toMatchObject({
      code: 'destination_not_found',
    });
  });

  it('flags encrypted rooms', async () => {
    const dest = await makeResolver().resolve({ type: 'private_room', value: 'cryptoroom' });
    expect(dest.encrypted).toBe(true);
  });

  it('resolves a user with an existing DM room', async () => {
    const dest = await makeResolver().resolve({ type: 'user', value: 'alice' });
    expect(dest).toMatchObject({
      type: 'direct',
      displayName: 'Alice',
      roomId: 'DM1',
      canUseSendMessage: true,
    });
  });

  it('resolves a user without an existing DM (no room id yet)', async () => {
    const dest = await makeResolver().resolve({ type: 'user', value: 'carol' });
    expect(dest).toMatchObject({
      type: 'direct',
      displayName: 'Carol',
      recipientUsername: 'carol',
      canUseSendMessage: false,
    });
    expect(dest.roomId).toBeUndefined();
  });

  it('errors on an unknown user', async () => {
    await expect(makeResolver().resolve({ type: 'user', value: 'bob' })).rejects.toMatchObject({
      code: 'destination_not_found',
    });
  });

  it('refuses to auto-select an ambiguous name', async () => {
    const dupSubs: RcSubscription[] = [
      { _id: 'a', rid: 'DUP1', name: 'dup', t: 'c' },
      { _id: 'b', rid: 'DUP2', name: 'dup', t: 'c' },
    ];
    await expect(
      makeResolver(dupSubs).resolve({ type: 'channel', value: 'dup' }),
    ).rejects.toMatchObject({
      code: 'ambiguous_destination',
    });
  });
});
