import { describe, it, expect } from 'vitest';
import {
  upsertJsonMcpServer,
  upsertClaudeCodeReadOnlyPermissions,
  renderCodexTomlBlock,
  upsertCodexToml,
  tomlString,
  type McpServerDef,
} from '../../src/setup/writers.js';

const DEF: McpServerDef = {
  command: '/usr/bin/node',
  args: ['/opt/app/dist/index.js'],
  env: { ROCKETCHAT_BASE_URL: 'https://chat.example.com', ROCKETCHAT_USER_ID: 'u1' },
};

describe('upsertJsonMcpServer', () => {
  it('creates mcpServers in an empty/absent file', () => {
    const { text, replaced } = upsertJsonMcpServer(undefined, 'rocketchat', DEF);
    const parsed = JSON.parse(text);
    expect(replaced).toBe(false);
    expect(parsed.mcpServers.rocketchat).toEqual(DEF);
  });

  it('preserves other top-level keys and other servers', () => {
    const existing = JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'x', args: [], env: {} } },
    });
    const { text } = upsertJsonMcpServer(existing, 'rocketchat', DEF);
    const parsed = JSON.parse(text);
    expect(parsed.theme).toBe('dark');
    expect(parsed.mcpServers.other).toBeDefined();
    expect(parsed.mcpServers.rocketchat).toEqual(DEF);
  });

  it('reports replaced=true when overwriting an existing entry', () => {
    const existing = JSON.stringify({
      mcpServers: { rocketchat: { command: 'old', args: [], env: {} } },
    });
    const { replaced } = upsertJsonMcpServer(existing, 'rocketchat', DEF);
    expect(replaced).toBe(true);
  });

  it('throws on invalid JSON rather than clobbering', () => {
    expect(() => upsertJsonMcpServer('{ not json', 'rocketchat', DEF)).toThrow();
  });

  it('throws when the root is not an object', () => {
    expect(() => upsertJsonMcpServer('[1,2,3]', 'rocketchat', DEF)).toThrow();
  });
});

describe('tomlString', () => {
  it('escapes backslashes and quotes', () => {
    expect(tomlString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe('upsertClaudeCodeReadOnlyPermissions', () => {
  it('preserves existing rules and adds each read-only tool exactly once', () => {
    const first = upsertClaudeCodeReadOnlyPermissions(
      JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }),
      'rocketchat',
    );
    const second = upsertClaudeCodeReadOnlyPermissions(first, 'rocketchat');
    const parsed = JSON.parse(second);
    expect(parsed.permissions.allow).toEqual([
      'Bash(git status)',
      'mcp__rocketchat__rocketchat_preview_message',
      'mcp__rocketchat__rocketchat_search_users',
      'mcp__rocketchat__rocketchat_list_rooms',
    ]);
  });
});

describe('renderCodexTomlBlock', () => {
  it('renders header, command, args and env subtable', () => {
    const block = renderCodexTomlBlock('rocketchat', DEF);
    expect(block).toContain('[mcp_servers.rocketchat]');
    expect(block).toContain('command = "/usr/bin/node"');
    expect(block).toContain('args = ["/opt/app/dist/index.js"]');
    expect(block).toContain('[mcp_servers.rocketchat.env]');
    expect(block).toContain('ROCKETCHAT_BASE_URL = "https://chat.example.com"');
    expect(block).toContain('[mcp_servers.rocketchat.tools.rocketchat_preview_message]');
    expect(block).toContain('[mcp_servers.rocketchat.tools.rocketchat_search_users]');
    expect(block).toContain('[mcp_servers.rocketchat.tools.rocketchat_list_rooms]');
    expect(block).toContain('approval_mode = "approve"');
  });
});

describe('upsertCodexToml', () => {
  it('appends a block to an empty file', () => {
    const { text, alreadyExists } = upsertCodexToml(undefined, 'rocketchat', DEF);
    expect(alreadyExists).toBe(false);
    expect(text).toContain('[mcp_servers.rocketchat]');
  });

  it('appends after existing content with separation', () => {
    const existing = 'model = "gpt-5"\n';
    const { text } = upsertCodexToml(existing, 'rocketchat', DEF);
    expect(text.startsWith('model = "gpt-5"')).toBe(true);
    expect(text).toContain('[mcp_servers.rocketchat]');
  });

  it('does not modify a file that already has the section', () => {
    const existing = '[mcp_servers.rocketchat]\ncommand = "old"\n';
    const result = upsertCodexToml(existing, 'rocketchat', DEF);
    expect(result.alreadyExists).toBe(true);
    expect(result.text).toBe(existing); // untouched
    expect(result).not.toHaveProperty('block');
  });
});
