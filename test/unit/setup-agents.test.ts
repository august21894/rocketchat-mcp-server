import { describe, it, expect } from 'vitest';
import { resolveAgents } from '../../src/setup/agents.js';

function byId(agents: ReturnType<typeof resolveAgents>, id: string) {
  return agents.find((a) => a.id === id)!;
}

describe('resolveAgents', () => {
  it('resolves macOS paths', () => {
    const agents = resolveAgents({ platform: 'darwin', homedir: '/Users/bob', env: {} });
    expect(byId(agents, 'claude-desktop').configPath).toBe(
      '/Users/bob/Library/Application Support/Claude/claude_desktop_config.json',
    );
    expect(byId(agents, 'claude-code').configPath).toBe('/Users/bob/.claude.json');
    expect(byId(agents, 'codex').configPath).toBe('/Users/bob/.codex/config.toml');
  });

  it('resolves Windows Claude Desktop path from APPDATA', () => {
    const agents = resolveAgents({
      platform: 'win32',
      homedir: 'C:\\Users\\bob',
      env: { APPDATA: 'C:\\Users\\bob\\AppData\\Roaming' },
    });
    expect(byId(agents, 'claude-desktop').configPath).toContain('Claude');
    expect(byId(agents, 'claude-desktop').configPath).toContain('claude_desktop_config.json');
  });

  it('resolves Linux path from XDG_CONFIG_HOME', () => {
    const agents = resolveAgents({
      platform: 'linux',
      homedir: '/home/bob',
      env: { XDG_CONFIG_HOME: '/home/bob/.myconfig' },
    });
    expect(byId(agents, 'claude-desktop').configPath).toBe(
      '/home/bob/.myconfig/Claude/claude_desktop_config.json',
    );
  });

  it('honors CODEX_HOME override', () => {
    const agents = resolveAgents({
      platform: 'linux',
      homedir: '/home/bob',
      env: { CODEX_HOME: '/opt/codex' },
    });
    expect(byId(agents, 'codex').configPath).toBe('/opt/codex/config.toml');
  });
});
