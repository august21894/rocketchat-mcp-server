import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createContext, type AppContext } from '../../src/container.js';
import { normalizeError } from '../../src/rocketchat/errors.js';
import { MockRocketChat, type MockSubscription } from '../fixtures/mock-rocketchat-server.js';
import { makeConfig } from '../fixtures/config.js';
import { silentLogger } from '../fixtures/logger.js';
import { TEST_TOKEN } from '../fixtures/config.js';

const USER_ID = 'bot-user-id';

const DEFAULT_SUBS: MockSubscription[] = [
  { _id: 's1', rid: 'GENERAL', name: 'general', t: 'c' },
  { _id: 's2', rid: 'DEVS', name: 'devs', t: 'p' },
  { _id: 's3', rid: 'ENC', name: 'secret-enc', t: 'p', encrypted: true },
  { _id: 's4', rid: 'RANDOM', name: 'random', t: 'c' },
  { _id: 's5', rid: 'DM-alice', name: 'alice', t: 'd' },
];

const mock = new MockRocketChat({
  userId: USER_ID,
  authToken: TEST_TOKEN,
  users: [
    { _id: 'u1', username: 'alice', name: 'Alice' },
    { _id: 'u2', username: 'bob', name: 'Bob' },
  ],
});

function seed(): void {
  mock.reset();
  mock.subscriptions = DEFAULT_SUBS.map((s) => ({ ...s }));
  mock.messages.clear();
  mock.messages.set('PARENT1', {
    _id: 'PARENT1',
    rid: 'GENERAL',
    msg: 'parent',
    ts: '2026-01-01T00:00:00.000Z',
    u: { _id: USER_ID, username: 'coding-agent' },
  });
  mock.messages.set('OTHER1', {
    _id: 'OTHER1',
    rid: 'DEVS',
    msg: 'other',
    ts: '2026-01-01T00:00:00.000Z',
    u: { _id: USER_ID, username: 'coding-agent' },
  });
}

function ctxWith(overrides: Record<string, string> = {}): AppContext {
  const config = makeConfig({
    ROCKETCHAT_BASE_URL: mock.baseUrl,
    ROCKETCHAT_ALLOWED_ROOMS: 'general,devs,secret-enc',
    ROCKETCHAT_ALLOW_DM: 'true',
    ROCKETCHAT_ALLOWED_DM_USERS: 'alice',
    ...overrides,
  });
  return createContext(config, { logger: silentLogger() });
}

function chatRequests() {
  return mock.requests.filter((r) => r.path.includes('/chat.'));
}

beforeAll(() => mock.start());
afterAll(() => mock.stop());
beforeEach(() => seed());

describe('connection', () => {
  it('connects with valid credentials', async () => {
    const result = await ctxWith().connectionService.testConnection();
    expect(result.connected).toBe(true);
    expect(result.user.id).toBe(USER_ID);
  });

  it('fails with invalid credentials', async () => {
    const ctx = ctxWith({ ROCKETCHAT_AUTH_TOKEN: 'wrong-token-value-xxxx' });
    try {
      await ctx.connectionService.testConnection();
      throw new Error('expected throw');
    } catch (error) {
      expect(normalizeError(error).code).toBe('authentication_failed');
    }
  });
});

describe('read tools', () => {
  it('searches users', async () => {
    const users = await ctxWith().userService.searchUsers('al', 10);
    expect(users.map((u) => u.username)).toContain('alice');
  });

  it('lists only policy-allowed joined rooms', async () => {
    const rooms = await ctxWith().roomService.listRooms({ limit: 50 });
    const names = rooms.map((r) => r.name).sort();
    // "random" is joined but not allow-listed; "bob" DM never existed.
    expect(names).toEqual(['alice', 'devs', 'general', 'secret-enc']);
    const general = rooms.find((r) => r.name === 'general');
    expect(general?.type).toBe('channel');
  });
});

describe('send — preview', () => {
  it('previews without any side effect', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'channel', value: 'general' },
      text: 'Build done.',
      mentions: ['alice'],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: true,
    });
    expect(result).toMatchObject({
      sent: false,
      preview: true,
      renderedText: '🤖 @alice Build done.',
    });
    expect(chatRequests()).toHaveLength(0);
  });

  it('does not duplicate an existing robot icon', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'channel', value: 'general' },
      text: '🤖 Already identified.',
      mentions: ['alice'],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: true,
    });
    expect(result).toMatchObject({ renderedText: '🤖 @alice Already identified.' });
  });

  it('renders code as a fenced block with the robot and mentions outside it', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'channel', value: 'general' },
      text: 'const answer = 42;',
      format: 'code_block',
      codeLanguage: 'typescript',
      mentions: ['alice'],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: true,
    });
    expect(result).toMatchObject({
      renderedText: '🤖 @alice\n\n```typescript\nconst answer = 42;\n```',
    });
  });

  it('uses a longer fence when the code contains backtick runs', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'channel', value: 'general' },
      text: 'const fence = "```";',
      format: 'code_block',
      codeLanguage: null,
      mentions: [],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: true,
    });
    expect(result).toMatchObject({
      renderedText: '🤖\n\n````\nconst fence = "```";\n````',
    });
  });
});

describe('send — delivery', () => {
  it('sends to a public channel', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'channel', value: 'general' },
      text: 'hello channel',
      mentions: [],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: false,
    });
    expect(result.sent).toBe(true);
    if (result.sent) expect(result.message.roomId).toBe('GENERAL');
    const send = chatRequests().find((r) => r.path.includes('sendMessage'));
    expect((send?.body as { message: { msg?: string } }).message.msg).toBe('🤖 hello channel');
  });

  it('sends to a private room', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'private_room', value: 'devs' },
      text: 'private hello',
      mentions: [],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: false,
    });
    expect(result.sent && result.message.roomId).toBe('DEVS');
  });

  it('sends a DM to an allowed user (existing room)', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'user', value: 'alice' },
      text: 'hi alice',
      mentions: [],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: false,
    });
    expect(result.sent && result.message.roomId).toBe('DM-alice');
  });

  it('creates a new DM via postMessage when no room exists yet', async () => {
    // Drop the existing DM subscription so resolution finds no room id.
    mock.subscriptions = mock.subscriptions.filter((s) => s.rid !== 'DM-alice');
    const result = await ctxWith().messageService.send({
      target: { type: 'user', value: 'alice' },
      text: 'first contact',
      mentions: [],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: false,
    });
    expect(result.sent).toBe(true);
    const post = chatRequests().find((r) => r.path.includes('postMessage'));
    expect(post?.body).toMatchObject({ channel: '@alice', text: '🤖 first contact' });
  });

  it('renders multiple mentions', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'channel', value: 'general' },
      text: 'ping',
      mentions: ['alice', 'bob'],
      groupMention: 'none',
      threadMessageId: null,
      idempotencyKey: null,
      dryRun: true,
    });
    expect(result).toMatchObject({ renderedText: '🤖 @alice @bob ping' });
  });

  it('sends a thread reply within the room', async () => {
    const result = await ctxWith().messageService.send({
      target: { type: 'channel', value: 'general' },
      text: 'in thread',
      mentions: [],
      groupMention: 'none',
      threadMessageId: 'PARENT1',
      idempotencyKey: null,
      dryRun: false,
    });
    expect(result.sent).toBe(true);
    const send = chatRequests().find((r) => r.path.includes('sendMessage'));
    expect((send?.body as { message: { tmid?: string } }).message.tmid).toBe('PARENT1');
    expect((send?.body as { message: { msg?: string } }).message.msg).toBe('🤖 in thread');
  });
});

describe('send — policy enforcement', () => {
  it('blocks @all and @here by default', async () => {
    const ctx = ctxWith();
    await expect(
      ctx.messageService.send({
        target: { type: 'channel', value: 'general' },
        text: 'x',
        mentions: [],
        groupMention: 'all',
        threadMessageId: null,
        idempotencyKey: null,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'mention_not_allowed' });

    await expect(
      ctx.messageService.send({
        target: { type: 'channel', value: 'general' },
        text: 'x',
        mentions: [],
        groupMention: 'here',
        threadMessageId: null,
        idempotencyKey: null,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'mention_not_allowed' });
  });

  it('blocks a room outside the allowlist', async () => {
    await expect(
      ctxWith().messageService.send({
        target: { type: 'channel', value: 'random' },
        text: 'x',
        mentions: [],
        groupMention: 'none',
        threadMessageId: null,
        idempotencyKey: null,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'destination_not_allowed' });
  });

  it('blocks a DM to a non-allowed user', async () => {
    mock.subscriptions.push({ _id: 's6', rid: 'DM-bob', name: 'bob', t: 'd' });
    await expect(
      ctxWith().messageService.send({
        target: { type: 'user', value: 'bob' },
        text: 'x',
        mentions: [],
        groupMention: 'none',
        threadMessageId: null,
        idempotencyKey: null,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'destination_not_allowed' });
  });

  it('blocks an E2EE room', async () => {
    await expect(
      ctxWith().messageService.send({
        target: { type: 'private_room', value: 'secret-enc' },
        text: 'x',
        mentions: [],
        groupMention: 'none',
        threadMessageId: null,
        idempotencyKey: null,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'encrypted_room_not_supported' });
  });

  it('rejects a thread parent from another room', async () => {
    await expect(
      ctxWith().messageService.send({
        target: { type: 'channel', value: 'general' },
        text: 'x',
        mentions: [],
        groupMention: 'none',
        threadMessageId: 'OTHER1',
        idempotencyKey: null,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'thread_room_mismatch' });
  });
});

describe('send — rate limiting', () => {
  it('maps a 429 during send to rate_limited', async () => {
    mock.enqueueOverride({
      status: 429,
      pathIncludes: '/chat.',
      headers: { 'x-ratelimit-reset': String(Date.now() + 3000) },
      body: { success: false, error: 'too many' },
    });
    await expect(
      ctxWith().messageService.send({
        target: { type: 'channel', value: 'general' },
        text: 'x',
        mentions: [],
        groupMention: 'none',
        threadMessageId: null,
        idempotencyKey: null,
        dryRun: false,
      }),
    ).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
  });
});

describe('send — idempotency', () => {
  it('does not double-send with the same key in one process', async () => {
    const ctx = ctxWith();
    const input = {
      target: { type: 'channel' as const, value: 'general' },
      text: 'deploy done',
      mentions: [],
      groupMention: 'none' as const,
      threadMessageId: null,
      idempotencyKey: 'deploy-42',
      dryRun: false,
    };
    const first = await ctx.messageService.send(input);
    const second = await ctx.messageService.send(input);
    expect(first.sent && !first.duplicate).toBe(true);
    expect(second.sent && second.duplicate).toBe(true);
    expect(chatRequests().filter((r) => r.path.includes('sendMessage'))).toHaveLength(1);
  });

  it('detects a duplicate at the Rocket.Chat layer across a fresh store', async () => {
    const input = {
      target: { type: 'channel' as const, value: 'general' },
      text: 'deploy done',
      mentions: [],
      groupMention: 'none' as const,
      threadMessageId: null,
      idempotencyKey: 'deploy-99',
      dryRun: false,
    };
    // First process/context sends successfully.
    const first = await ctxWith().messageService.send(input);
    expect(first.sent && !first.duplicate).toBe(true);
    // A fresh context (empty in-memory store) re-uses the deterministic _id;
    // Rocket.Chat rejects the duplicate and we report duplicate=true.
    const second = await ctxWith().messageService.send(input);
    expect(second.sent && second.duplicate).toBe(true);
  });
});
