import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RocketChatClient, type FetchLike } from '../../src/rocketchat/client.js';
import { normalizeError } from '../../src/rocketchat/errors.js';
import { MockRocketChat } from '../fixtures/mock-rocketchat-server.js';
import { silentLogger } from '../fixtures/logger.js';
import { TEST_TOKEN } from '../fixtures/config.js';

const USER_ID = 'bot-user-id';

const mock = new MockRocketChat({
  userId: USER_ID,
  authToken: TEST_TOKEN,
  users: [{ _id: 'u1', username: 'alice', name: 'Alice' }],
  subscriptions: [{ _id: 's1', rid: 'GENERAL', name: 'general', t: 'c' }],
});

function makeClient(overrides: Partial<ConstructorParameters<typeof RocketChatClient>[0]> = {}) {
  return new RocketChatClient({
    baseUrl: mock.baseUrl,
    userId: USER_ID,
    authToken: TEST_TOKEN,
    timeoutMs: 5000,
    logger: silentLogger(),
    retryBackoffMs: 1,
    ...overrides,
  });
}

beforeAll(() => mock.start());
afterAll(() => mock.stop());
beforeEach(() => mock.reset());

describe('RocketChatClient — authentication & requests', () => {
  it('attaches X-User-Id and X-Auth-Token headers', async () => {
    await makeClient().me();
    const req = mock.requests.at(-1)!;
    expect(req.headers['x-user-id']).toBe(USER_ID);
    expect(req.headers['x-auth-token']).toBe(TEST_TOKEN);
    expect(req.headers['accept']).toContain('application/json');
  });

  it('returns the authenticated identity from /me', async () => {
    const me = await makeClient().me();
    expect(me._id).toBe(USER_ID);
    expect(me.username).toBe('coding-agent');
  });

  it('sends a JSON selector to users.autocomplete', async () => {
    const users = await makeClient().usersAutocomplete('ali');
    expect(users).toHaveLength(1);
    const req = mock.requests.at(-1)!;
    expect(JSON.parse(req.query.selector!)).toMatchObject({ term: 'ali' });
  });

  it('reads subscriptions', async () => {
    const subs = await makeClient().subscriptionsGet();
    expect(subs.map((s) => s.rid)).toEqual(['GENERAL']);
  });
});

describe('RocketChatClient — write payloads', () => {
  it('posts exactly the allow-listed chat.postMessage fields', async () => {
    await makeClient().chatPostMessage({ channel: '#general', text: 'hi', parseUrls: false });
    const req = mock.requests.at(-1)!;
    expect(req.body).toEqual({ channel: '#general', text: 'hi', parseUrls: false });
    const body = req.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('alias');
    expect(body).not.toHaveProperty('avatar');
    expect(body).not.toHaveProperty('attachments');
  });

  it('sends exactly the allow-listed chat.sendMessage fields', async () => {
    await makeClient().chatSendMessage({
      message: { rid: 'GENERAL', msg: 'hi', _id: 'abc', parseUrls: false },
    });
    const req = mock.requests.at(-1)!;
    expect(req.body).toEqual({
      message: { rid: 'GENERAL', msg: 'hi', _id: 'abc', parseUrls: false },
    });
    const message = (req.body as { message: Record<string, unknown> }).message;
    expect(message).not.toHaveProperty('alias');
    expect(message).not.toHaveProperty('avatar');
  });
});

describe('RocketChatClient — error mapping', () => {
  it.each([
    [401, 'authentication_failed'],
    [403, 'permission_denied'],
    [404, 'destination_not_found'],
    [500, 'rocketchat_error'],
  ])('maps HTTP %i to %s', async (status, code) => {
    mock.enqueueOverride({ status, body: { success: false, error: 'x' } });
    // Use a no-retry client for 500 so we assert the mapping, not the retry.
    const client = makeClient({ maxGetRetries: 0 });
    try {
      await client.me();
      throw new Error('expected throw');
    } catch (error) {
      expect(normalizeError(error).code).toBe(code);
    }
  });

  it('maps 429 to rate_limited with retryAfterMs', async () => {
    const resetAt = Date.now() + 4000;
    mock.enqueueOverride({
      status: 429,
      headers: { 'x-ratelimit-reset': String(resetAt), 'x-ratelimit-remaining': '0' },
      body: { success: false, error: 'too many' },
    });
    try {
      await makeClient().me();
      throw new Error('expected throw');
    } catch (error) {
      const app = normalizeError(error);
      expect(app.code).toBe('rate_limited');
      expect(app.retryable).toBe(true);
      expect(app.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('treats a 2xx body with success:false as an error', async () => {
    mock.enqueueOverride({
      status: 200,
      body: { success: false, error: 'nope', errorType: 'error-not-allowed' },
    });
    await expect(makeClient().subscriptionsGet()).rejects.toBeDefined();
  });
});

describe('RocketChatClient — retry policy', () => {
  it('retries GET requests on 5xx', async () => {
    mock.enqueueOverride({ status: 503, body: { success: false } });
    mock.enqueueOverride({ status: 503, body: { success: false } });
    const me = await makeClient({ maxGetRetries: 2 }).me();
    expect(me._id).toBe(USER_ID);
    expect(mock.requests).toHaveLength(3); // 2 failures + 1 success
  });

  it('does NOT retry write requests', async () => {
    mock.enqueueOverride({ status: 503, body: { success: false } });
    await expect(
      makeClient({ maxGetRetries: 2 }).chatPostMessage({ channel: '#general', text: 'x' }),
    ).rejects.toBeDefined();
    expect(mock.requests).toHaveLength(1); // no retry
  });
});

describe('RocketChatClient — timeout', () => {
  it('aborts and maps to request_timeout', async () => {
    const neverResolves: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    const client = makeClient({ timeoutMs: 50, fetchFn: neverResolves });
    try {
      await client.me();
      throw new Error('expected throw');
    } catch (error) {
      expect(normalizeError(error).code).toBe('request_timeout');
    }
  });
});
