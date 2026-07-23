import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MockRocketChat } from '../fixtures/mock-rocketchat-server.js';
import { TEST_TOKEN } from '../fixtures/config.js';

const USER_ID = 'bot-user-id';
const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const entry = fileURLToPath(new URL('../../src/index.ts', import.meta.url));

const mock = new MockRocketChat({
  userId: USER_ID,
  authToken: TEST_TOKEN,
  users: [{ _id: 'u1', username: 'alice', name: 'Alice' }],
  subscriptions: [{ _id: 's1', rid: 'GENERAL', name: 'general', t: 'c' }],
});

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  await mock.start();
  transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', entry],
    cwd: projectRoot,
    stderr: 'ignore',
    env: {
      ROCKETCHAT_BASE_URL: mock.baseUrl,
      ROCKETCHAT_USER_ID: USER_ID,
      ROCKETCHAT_AUTH_TOKEN: TEST_TOKEN,
      ROCKETCHAT_WORKSPACE_NAME: 'Facon',
      ROCKETCHAT_ALLOWED_ROOMS: 'general',
      ROCKETCHAT_ALLOW_DM: 'true',
      ROCKETCHAT_ALLOWED_DM_USERS: 'alice',
      LOG_LEVEL: 'error',
    },
  });
  client = new Client({ name: 'e2e-test-client', version: '0.0.0' });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
  await mock.stop();
});

describe('MCP stdio end-to-end', () => {
  it('advertises workspace-aware server instructions', () => {
    const instructions = client.getInstructions();
    expect(instructions).toContain('"Facon"');
    expect(instructions).toContain('always call rocketchat_preview_message first');
    expect(instructions).toContain('Copy the ENTIRE previewText field verbatim');
    expect(instructions).toContain('Never display only renderedText');
    expect(instructions).toContain('Only after displaying that complete preview');
    expect(instructions).toContain('rocketchat_send_message');
  });

  it('exposes exactly the five tools with correct annotations', async () => {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual([
      'rocketchat_list_rooms',
      'rocketchat_preview_message',
      'rocketchat_search_users',
      'rocketchat_send_message',
      'rocketchat_test_connection',
    ]);

    for (const name of [
      'rocketchat_test_connection',
      'rocketchat_search_users',
      'rocketchat_list_rooms',
      'rocketchat_preview_message',
    ]) {
      expect(byName.get(name)?.annotations?.readOnlyHint).toBe(true);
    }
    const send = byName.get('rocketchat_send_message');
    expect(send?.annotations?.readOnlyHint).toBe(false);
    expect(send?.annotations?.openWorldHint).toBe(true);
    expect(send?.description).toContain('rocketchat_preview_message must be called');
    expect(send?.description).toContain('shown verbatim');
    // Every tool advertises an input schema and the configured workspace.
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.title).toContain('Facon');
      expect(tool.description).toContain('"Facon"');
    }
  });

  it('runs rocketchat_test_connection', async () => {
    const result = await client.callTool({ name: 'rocketchat_test_connection', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ connected: true, user: { id: USER_ID } });
  });

  it('runs rocketchat_search_users', async () => {
    const result = await client.callTool({
      name: 'rocketchat_search_users',
      arguments: { query: 'al' },
    });
    const users = (result.structuredContent as { users: { username: string }[] }).users;
    expect(users.map((u) => u.username)).toContain('alice');
  });

  it('runs rocketchat_list_rooms', async () => {
    const result = await client.callTool({ name: 'rocketchat_list_rooms', arguments: {} });
    const rooms = (result.structuredContent as { rooms: { name: string }[] }).rooms;
    expect(rooms.map((r) => r.name)).toContain('general');
  });

  it('returns a human-readable message preview without side effects', async () => {
    const before = mock.requests.filter((r) => r.path.includes('/chat.')).length;
    const result = await client.callTool({
      name: 'rocketchat_preview_message',
      arguments: {
        target: { type: 'channel', value: 'general' },
        text: 'Build done.',
        mentions: ['alice'],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      sent: false,
      preview: true,
      destination: { type: 'channel', name: 'general' },
      renderedText: '🤖 @alice Build done.',
      previewText: '📨 **Facon → #general**\n\n> 🤖 @alice Build done.',
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toBe('📨 **Facon → #general**\n\n> 🤖 @alice Build done.');
    const after = mock.requests.filter((r) => r.path.includes('/chat.')).length;
    expect(after).toBe(before);
  });

  it('uses a recipient display name and truncates only human preview text', async () => {
    const longText = 'a'.repeat(301);
    const result = await client.callTool({
      name: 'rocketchat_preview_message',
      arguments: { target: { type: 'user', value: 'alice' }, text: longText },
    });
    expect(result.structuredContent).toMatchObject({
      destination: { displayName: 'Alice', recipientUsername: 'alice' },
      renderedText: `🤖 ${longText}`,
      previewText: `📨 **Facon → Alice (@alice)**\n\n> 🤖 ${'a'.repeat(298)}...`,
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toBe(`📨 **Facon → Alice (@alice)**\n\n> 🤖 ${'a'.repeat(298)}...`);
  });

  it('previews a send with dryRun=true (no side effect)', async () => {
    const before = mock.requests.filter((r) => r.path.includes('/chat.')).length;
    const result = await client.callTool({
      name: 'rocketchat_send_message',
      arguments: {
        target: { type: 'channel', value: 'general' },
        text: 'preview me',
        dryRun: true,
      },
    });
    expect(result.structuredContent).toMatchObject({ sent: false, preview: true });
    const after = mock.requests.filter((r) => r.path.includes('/chat.')).length;
    expect(after).toBe(before);
  });

  it('sends a real message with dryRun=false', async () => {
    const result = await client.callTool({
      name: 'rocketchat_send_message',
      arguments: {
        target: { type: 'channel', value: 'general' },
        text: 'shipped',
        dryRun: false,
      },
    });
    expect(result.structuredContent).toMatchObject({ sent: true });
  });

  it('confirms a DM send with the recipient display name', async () => {
    const result = await client.callTool({
      name: 'rocketchat_send_message',
      arguments: {
        target: { type: 'user', value: 'alice' },
        text: 'Shipped',
        dryRun: false,
      },
    });
    expect(result.structuredContent).toMatchObject({
      sent: true,
      destination: { displayName: 'Alice', recipientUsername: 'alice' },
    });
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(text).toBe('✅ Đã gửi tin nhắn Facon cho Alice (@alice).');
  });

  it('returns a structured error for a disallowed destination', async () => {
    const result = await client.callTool({
      name: 'rocketchat_send_message',
      arguments: {
        target: { type: 'channel', value: 'nonexistent' },
        text: 'x',
        dryRun: false,
      },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]!.text;
    expect(JSON.parse(text).error.code).toBe('destination_not_found');
    // Token must never appear in a tool result.
    expect(text).not.toContain(TEST_TOKEN);
  });
});
