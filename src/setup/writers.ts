/**
 * Pure config writers for the setup wizard. No I/O here so they can be unit
 * tested: given the existing file text, return the new text.
 */

export interface McpServerDef {
  command: string;
  args: string[];
  env: Record<string, string>;
}

const AUTO_APPROVED_READ_ONLY_TOOLS = [
  'rocketchat_preview_message',
  'rocketchat_preview_file',
  'rocketchat_search_users',
  'rocketchat_list_rooms',
] as const;

/**
 * Upsert `mcpServers.<name>` into a JSON config (Claude Desktop / Claude Code),
 * preserving every other key. Throws if the existing text is not valid JSON —
 * the caller must decide whether to abort rather than clobber a user file.
 */
export function upsertJsonMcpServer(
  existingText: string | undefined,
  name: string,
  def: McpServerDef,
): { text: string; replaced: boolean } {
  let root: Record<string, unknown> = {};
  if (existingText && existingText.trim() !== '') {
    const parsed = JSON.parse(existingText) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      root = parsed as Record<string, unknown>;
    } else {
      throw new Error('Existing config is not a JSON object.');
    }
  }

  const current = root.mcpServers;
  const servers: Record<string, unknown> =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};

  const replaced = Object.prototype.hasOwnProperty.call(servers, name);
  servers[name] = def;
  root.mcpServers = servers;

  return { text: JSON.stringify(root, null, 2) + '\n', replaced };
}

/** Allow only selected read-only tools in Claude Code; writes still prompt. */
export function upsertClaudeCodeReadOnlyPermissions(
  existingText: string | undefined,
  serverName: string,
): string {
  let root: Record<string, unknown> = {};
  if (existingText?.trim()) {
    const parsed = JSON.parse(existingText) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Existing Claude Code settings are not a JSON object.');
    }
    root = parsed as Record<string, unknown>;
  }

  const currentPermissions = root.permissions;
  if (
    currentPermissions !== undefined &&
    (!currentPermissions ||
      typeof currentPermissions !== 'object' ||
      Array.isArray(currentPermissions))
  ) {
    throw new Error('Existing Claude Code permissions are not a JSON object.');
  }
  const permissions = (currentPermissions ?? {}) as Record<string, unknown>;
  const currentAllow = permissions.allow;
  if (
    currentAllow !== undefined &&
    (!Array.isArray(currentAllow) || !currentAllow.every(isString))
  ) {
    throw new Error('Existing Claude Code permissions.allow is not a string array.');
  }

  const allow = [...((currentAllow ?? []) as string[])];
  for (const tool of AUTO_APPROVED_READ_ONLY_TOOLS) {
    const permission = `mcp__${serverName}__${tool}`;
    if (!allow.includes(permission)) allow.push(permission);
  }
  permissions.allow = allow;
  root.permissions = permissions;
  return JSON.stringify(root, null, 2) + '\n';
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** Escape a string for a TOML basic (double-quoted) string. */
export function tomlString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** Render a Codex `[mcp_servers.<name>]` table block. */
export function renderCodexTomlBlock(name: string, def: McpServerDef): string {
  const lines: string[] = [];
  lines.push(`[mcp_servers.${name}]`);
  lines.push(`command = ${tomlString(def.command)}`);
  lines.push(`args = [${def.args.map(tomlString).join(', ')}]`);
  const envKeys = Object.keys(def.env);
  if (envKeys.length > 0) {
    lines.push('');
    lines.push(`[mcp_servers.${name}.env]`);
    for (const key of envKeys) {
      lines.push(`${key} = ${tomlString(def.env[key] ?? '')}`);
    }
  }
  for (const tool of AUTO_APPROVED_READ_ONLY_TOOLS) {
    lines.push('');
    lines.push(`[mcp_servers.${name}.tools.${tool}]`);
    lines.push('approval_mode = "approve"');
  }
  return lines.join('\n') + '\n';
}

/**
 * Append a Codex server block to an existing `config.toml`. Because we do not
 * bundle a TOML parser, we do NOT rewrite an existing block: if the section is
 * already present, we return the untouched text without rendering a replacement
 * block. This avoids propagating secrets that must not be printed by the CLI.
 */
export function upsertCodexToml(
  existingText: string | undefined,
  name: string,
  def: McpServerDef,
): { text: string; alreadyExists: boolean } {
  const base = existingText ?? '';
  const header = `[mcp_servers.${name}]`;

  if (base.includes(header)) {
    return { text: base, alreadyExists: true };
  }

  const block = renderCodexTomlBlock(name, def);
  let prefix = base;
  if (prefix.trim() === '') {
    prefix = '';
  } else if (!prefix.endsWith('\n')) {
    prefix += '\n\n';
  } else if (!prefix.endsWith('\n\n')) {
    prefix += '\n';
  }
  return { text: prefix + block, alreadyExists: false };
}
