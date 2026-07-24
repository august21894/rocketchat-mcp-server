import { join } from 'node:path';
import type { AgentId } from './types.js';

export interface PathContext {
  platform: NodeJS.Platform;
  homedir: string;
  env: NodeJS.ProcessEnv;
}

export interface AppPaths {
  dataDir: string;
  configDir: string;
  runtimeDir: string;
  profilesDir: string;
}

export interface AgentPath {
  id: AgentId;
  label: string;
  kind: 'json' | 'codex-toml';
  configPath: string;
  /** Claude Code permission settings, when this client supports them. */
  permissionConfigPath?: string;
  restartNote: string;
}

export function resolveAppPaths(ctx: PathContext): AppPaths {
  let dataDir: string;
  let configDir: string;

  if (ctx.platform === 'darwin') {
    const appSupport = join(ctx.homedir, 'Library', 'Application Support', 'rocketchat-mcp');
    dataDir = appSupport;
    configDir = appSupport;
  } else if (ctx.platform === 'win32') {
    dataDir = join(ctx.env.LOCALAPPDATA ?? join(ctx.homedir, 'AppData', 'Local'), 'rocketchat-mcp');
    configDir = join(ctx.env.APPDATA ?? join(ctx.homedir, 'AppData', 'Roaming'), 'rocketchat-mcp');
  } else {
    dataDir = join(ctx.env.XDG_DATA_HOME ?? join(ctx.homedir, '.local', 'share'), 'rocketchat-mcp');
    configDir = join(ctx.env.XDG_CONFIG_HOME ?? join(ctx.homedir, '.config'), 'rocketchat-mcp');
  }

  return {
    dataDir,
    configDir,
    runtimeDir: join(dataDir, 'runtime'),
    profilesDir: join(configDir, 'profiles'),
  };
}

export function resolveAgentPaths(ctx: PathContext): AgentPath[] {
  const claudeDesktopPath =
    ctx.platform === 'darwin'
      ? join(ctx.homedir, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
      : ctx.platform === 'win32'
        ? join(
            ctx.env.APPDATA ?? join(ctx.homedir, 'AppData', 'Roaming'),
            'Claude',
            'claude_desktop_config.json',
          )
        : join(
            ctx.env.XDG_CONFIG_HOME ?? join(ctx.homedir, '.config'),
            'Claude',
            'claude_desktop_config.json',
          );

  return [
    {
      id: 'codex',
      label: 'Codex',
      kind: 'codex-toml',
      configPath: join(ctx.env.CODEX_HOME ?? join(ctx.homedir, '.codex'), 'config.toml'),
      restartNote: 'Start a new Codex session, then run /mcp.',
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      kind: 'json',
      configPath: join(ctx.homedir, '.claude.json'),
      permissionConfigPath: join(ctx.homedir, '.claude', 'settings.json'),
      restartNote: 'Start a new Claude Code session, then run /mcp.',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      kind: 'json',
      configPath: claudeDesktopPath,
      restartNote: 'Quit Claude Desktop completely and open it again.',
    },
  ];
}

export function profilePath(paths: AppPaths, profile: string): string {
  return join(paths.profilesDir, `${profile}.env`);
}
