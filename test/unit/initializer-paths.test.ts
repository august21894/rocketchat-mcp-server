import { describe, expect, it } from 'vitest';
import {
  profilePath,
  resolveAgentPaths,
  resolveAppPaths,
} from '../../packages/create-rocketchat-mcp/src/paths.js';

describe('initializer paths', () => {
  it('uses XDG directories on Linux', () => {
    const context = {
      platform: 'linux' as const,
      homedir: '/home/alice',
      env: {
        XDG_DATA_HOME: '/data/alice',
        XDG_CONFIG_HOME: '/config/alice',
      },
    };
    const paths = resolveAppPaths(context);
    expect(paths.runtimeDir).toBe('/data/alice/rocketchat-mcp/runtime');
    expect(profilePath(paths, 'facon')).toBe('/config/alice/rocketchat-mcp/profiles/facon.env');
  });

  it('honors CODEX_HOME and resolves all supported clients', () => {
    const agents = resolveAgentPaths({
      platform: 'darwin',
      homedir: '/Users/alice',
      env: { CODEX_HOME: '/custom/codex' },
    });
    expect(agents.map((agent) => agent.id)).toEqual(['codex', 'claude-code', 'claude-desktop']);
    expect(agents[0]!.configPath).toBe('/custom/codex/config.toml');
    expect(agents[1]!.permissionConfigPath).toBe('/Users/alice/.claude/settings.json');
  });
});
