import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FileTransaction,
  configureAgent,
  upsertCodexManagedBlock,
  upsertJsonServer,
} from '../../packages/create-rocketchat-mcp/src/agents.js';
import type { AgentPath } from '../../packages/create-rocketchat-mcp/src/paths.js';
import type { McpServerDefinition } from '../../packages/create-rocketchat-mcp/src/types.js';

const dirs: string[] = [];
const definition: McpServerDefinition = {
  command: '/usr/bin/node',
  args: ['/stable/runtime/dist/index.js'],
  env: { ROCKETCHAT_ENV_FILE: '/profiles/facon.env' },
};

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-rc-mcp-'));
  dirs.push(dir);
  return dir;
}

describe('initializer agent writers', () => {
  it('preserves unrelated JSON configuration', () => {
    const existing = JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'other' } },
    });
    const parsed = JSON.parse(upsertJsonServer(existing, 'rocketchat-facon', definition));
    expect(parsed.theme).toBe('dark');
    expect(parsed.mcpServers.other).toEqual({ command: 'other' });
    expect(parsed.mcpServers['rocketchat-facon']).toEqual(definition);
  });

  it('updates its managed Codex block without creating duplicates', () => {
    const first = upsertCodexManagedBlock('model = "gpt-5"\n', 'rocketchat-facon', definition);
    const second = upsertCodexManagedBlock(first, 'rocketchat-facon', {
      ...definition,
      args: ['/new/runtime/dist/index.js'],
    });
    expect(second.match(/\[mcp_servers\.rocketchat-facon\]/g)).toHaveLength(1);
    expect(second).toContain('/new/runtime/dist/index.js');
    expect(second).not.toContain('/stable/runtime/dist/index.js');
    expect(second).toContain('model = "gpt-5"');
  });

  it('refuses to overwrite an unmanaged Codex block', () => {
    expect(() =>
      upsertCodexManagedBlock(
        '[mcp_servers.rocketchat-facon]\ncommand = "custom"\n',
        'rocketchat-facon',
        definition,
      ),
    ).toThrow(/unmanaged/);
  });

  it('backs up configuration and restores it on rollback', () => {
    const dir = tempDir();
    const path = join(dir, 'config.json');
    const original = JSON.stringify({ keep: true }) + '\n';
    writeFileSync(path, original, { encoding: 'utf8', mode: 0o640 });
    const agent: AgentPath = {
      id: 'claude-code',
      label: 'Claude Code',
      kind: 'json',
      configPath: path,
      restartNote: '',
    };
    const transaction = new FileTransaction();

    configureAgent(agent, 'rocketchat-facon', definition, transaction);
    expect(readFileSync(path, 'utf8')).toContain('rocketchat-facon');
    expect(transaction.backups).toHaveLength(1);
    expect(existsSync(transaction.backups[0]!)).toBe(true);

    transaction.rollback();
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(statSync(path).mode & 0o777).toBe(0o640);
  });
});
