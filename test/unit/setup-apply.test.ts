import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyToAgent, SERVER_KEY } from '../../src/setup/apply.js';
import type { ResolvedAgent } from '../../src/setup/agents.js';
import type { McpServerDef } from '../../src/setup/writers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tmpFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rc-apply-'));
  dirs.push(dir);
  return join(dir, name);
}

const DEF: McpServerDef = {
  command: '/usr/bin/node',
  args: ['/opt/app/dist/index.js'],
  env: {
    ROCKETCHAT_BASE_URL: 'https://chat.example.com',
    ROCKETCHAT_AUTH_TOKEN: 'regression-secret-token',
  },
};

function jsonAgent(path: string): ResolvedAgent {
  return {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    kind: 'json',
    configPath: path,
    postNote: '',
  };
}
function codexAgent(path: string): ResolvedAgent {
  return { id: 'codex', label: 'Codex CLI', kind: 'codex-toml', configPath: path, postNote: '' };
}

describe('applyToAgent — JSON', () => {
  it('creates a new config file', () => {
    const path = tmpFile('claude_desktop_config.json');
    const r = applyToAgent(jsonAgent(path), DEF);
    expect(r.status).toBe('added');
    expect(r.backupPath).toBeUndefined();
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.mcpServers[SERVER_KEY]).toEqual(DEF);
  });

  it('merges into an existing file and writes a backup', () => {
    const path = tmpFile('claude_desktop_config.json');
    writeFileSync(path, JSON.stringify({ theme: 'dark', mcpServers: { other: {} } }), 'utf8');
    const r = applyToAgent(jsonAgent(path), DEF);
    expect(r.status).toBe('added');
    expect(r.backupPath).toBe(path + '.bak');
    expect(existsSync(path + '.bak')).toBe(true);
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed.theme).toBe('dark');
    expect(parsed.mcpServers.other).toBeDefined();
    expect(parsed.mcpServers[SERVER_KEY]).toEqual(DEF);
  });

  it('reports updated when overwriting an existing entry', () => {
    const path = tmpFile('config.json');
    writeFileSync(path, JSON.stringify({ mcpServers: { [SERVER_KEY]: { old: true } } }), 'utf8');
    const r = applyToAgent(jsonAgent(path), DEF);
    expect(r.status).toBe('updated');
  });

  it('refuses to clobber invalid JSON', () => {
    const path = tmpFile('config.json');
    writeFileSync(path, '{ this is not json', 'utf8');
    const r = applyToAgent(jsonAgent(path), DEF);
    expect(r.status).toBe('invalid-json');
    // File left untouched, no backup created.
    expect(readFileSync(path, 'utf8')).toBe('{ this is not json');
    expect(existsSync(path + '.bak')).toBe(false);
  });
});

describe('applyToAgent — Codex TOML', () => {
  it('appends a new block', () => {
    const path = tmpFile('config.toml');
    const r = applyToAgent(codexAgent(path), DEF);
    expect(r.status).toBe('added');
    expect(readFileSync(path, 'utf8')).toContain(`[mcp_servers.${SERVER_KEY}]`);
  });

  it('does not modify a file that already has the section', () => {
    const path = tmpFile('config.toml');
    const original = `[mcp_servers.${SERVER_KEY}]\ncommand = "old"\n`;
    writeFileSync(path, original, 'utf8');
    const r = applyToAgent(codexAgent(path), DEF);
    expect(r.status).toBe('exists-manual');
    expect(r).not.toHaveProperty('block');
    expect(JSON.stringify(r)).not.toContain(DEF.env.ROCKETCHAT_AUTH_TOKEN);
    expect(readFileSync(path, 'utf8')).toBe(original); // untouched
  });
});
