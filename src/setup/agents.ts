/**
 * Supported MCP clients ("agents") and where their config lives per platform.
 * Path resolution is pure (platform/homedir/env injected) so it can be tested.
 */
import { join } from 'node:path';

export type AgentKind = 'json' | 'codex-toml';

export interface ResolveContext {
  platform: NodeJS.Platform;
  homedir: string;
  env: NodeJS.ProcessEnv;
}

export interface ResolvedAgent {
  id: string;
  label: string;
  kind: AgentKind;
  /** Absolute config path, or null if this agent is unsupported on the platform. */
  configPath: string | null;
  /** Claude Code permission settings, when this client supports them. */
  permissionConfigPath?: string;
  /** Shown after a successful write. */
  postNote: string;
}

function claudeDesktopPath(ctx: ResolveContext): string {
  if (ctx.platform === 'darwin') {
    return join(
      ctx.homedir,
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (ctx.platform === 'win32') {
    const appData = ctx.env.APPDATA ?? join(ctx.homedir, 'AppData', 'Roaming');
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  const configHome = ctx.env.XDG_CONFIG_HOME ?? join(ctx.homedir, '.config');
  return join(configHome, 'Claude', 'claude_desktop_config.json');
}

function claudeCodePath(ctx: ResolveContext): string {
  // Claude Code stores user-scope MCP servers in ~/.claude.json.
  return join(ctx.homedir, '.claude.json');
}

function codexPath(ctx: ResolveContext): string {
  const codexHome = ctx.env.CODEX_HOME ?? join(ctx.homedir, '.codex');
  return join(codexHome, 'config.toml');
}

export function resolveAgents(ctx: ResolveContext): ResolvedAgent[] {
  return [
    {
      id: 'claude-code',
      label: 'Claude Code (CLI)',
      kind: 'json',
      configPath: claudeCodePath(ctx),
      permissionConfigPath: join(ctx.homedir, '.claude', 'settings.json'),
      postNote:
        'Mở lại phiên Claude Code và gõ /mcp để kiểm tra (cấu hình user-scope ~/.claude.json).',
    },
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      kind: 'json',
      configPath: claudeDesktopPath(ctx),
      postNote: 'Thoát hẳn rồi mở lại Claude Desktop để nạp MCP.',
    },
    {
      id: 'codex',
      label: 'Codex CLI',
      kind: 'codex-toml',
      configPath: codexPath(ctx),
      postNote: 'Chạy `codex mcp list` để kiểm tra.',
    },
  ];
}
