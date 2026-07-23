import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AgentPath } from './paths.js';
import type { McpServerDefinition } from './types.js';

interface Snapshot {
  existed: boolean;
  content?: string;
  mode?: number;
}

export class FileTransaction {
  private readonly snapshots = new Map<string, Snapshot>();
  readonly backups: string[] = [];

  write(path: string, content: string, mode?: number): void {
    if (!this.snapshots.has(path)) {
      if (existsSync(path)) {
        const snapshot: Snapshot = {
          existed: true,
          content: readFileSync(path, 'utf8'),
          mode: statSync(path).mode & 0o777,
        };
        this.snapshots.set(path, snapshot);
        const backup = `${path}.backup-${timestamp()}`;
        copyFileSync(path, backup);
        this.backups.push(backup);
      } else {
        this.snapshots.set(path, { existed: false });
      }
    }
    atomicWrite(path, content, mode);
  }

  rollback(): void {
    for (const [path, snapshot] of Array.from(this.snapshots.entries()).reverse()) {
      if (!snapshot.existed) {
        rmSync(path, { force: true });
        continue;
      }
      atomicWrite(path, snapshot.content ?? '', snapshot.mode);
    }
  }
}

export function configureAgent(
  agent: AgentPath,
  serverName: string,
  definition: McpServerDefinition,
  transaction: FileTransaction,
): void {
  const existing = existsSync(agent.configPath)
    ? readFileSync(agent.configPath, 'utf8')
    : undefined;
  const next =
    agent.kind === 'json'
      ? upsertJsonServer(existing, serverName, definition)
      : upsertCodexManagedBlock(existing, serverName, definition);
  transaction.write(agent.configPath, next);
}

export function upsertJsonServer(
  existing: string | undefined,
  serverName: string,
  definition: McpServerDefinition,
): string {
  let root: Record<string, unknown> = {};
  if (existing?.trim()) {
    const parsed = JSON.parse(existing) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Existing MCP client configuration is not a JSON object.');
    }
    root = parsed as Record<string, unknown>;
  }
  const current = root.mcpServers;
  const servers =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  servers[serverName] = definition;
  root.mcpServers = servers;
  return JSON.stringify(root, null, 2) + '\n';
}

export function upsertCodexManagedBlock(
  existing: string | undefined,
  serverName: string,
  definition: McpServerDefinition,
): string {
  assertServerName(serverName);
  const start = `# BEGIN create-rocketchat-mcp:${serverName}`;
  const end = `# END create-rocketchat-mcp:${serverName}`;
  const block = renderCodexBlock(start, end, serverName, definition);
  const base = existing ?? '';
  const startIndex = base.indexOf(start);
  const endIndex = base.indexOf(end);

  if (startIndex >= 0 || endIndex >= 0) {
    if (startIndex < 0 || endIndex < startIndex) {
      throw new Error(`Managed Codex block for "${serverName}" is malformed.`);
    }
    const afterEnd = endIndex + end.length;
    return base.slice(0, startIndex) + block.trimEnd() + base.slice(afterEnd);
  }

  if (base.includes(`[mcp_servers.${serverName}]`)) {
    throw new Error(
      `Codex already has an unmanaged [mcp_servers.${serverName}] block. ` +
        'Rename or remove it before continuing.',
    );
  }

  const separator =
    base.trim() === '' ? '' : base.endsWith('\n\n') ? '' : base.endsWith('\n') ? '\n' : '\n\n';
  return base + separator + block;
}

function renderCodexBlock(
  start: string,
  end: string,
  serverName: string,
  definition: McpServerDefinition,
): string {
  const lines = [
    start,
    `[mcp_servers.${serverName}]`,
    `command = ${tomlString(definition.command)}`,
    `args = [${definition.args.map(tomlString).join(', ')}]`,
  ];
  const envEntries = Object.entries(definition.env);
  if (envEntries.length > 0) {
    lines.push('', `[mcp_servers.${serverName}.env]`);
    for (const [key, value] of envEntries) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }
  lines.push(end);
  return lines.join('\n') + '\n';
}

function atomicWrite(path: string, content: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${Date.now()}-${process.pid}.tmp`);
  writeFileSync(temp, content, { encoding: 'utf8', mode: mode ?? 0o600 });
  renameSync(temp, path);
  if (mode !== undefined) chmodSync(path, mode);
}

function tomlString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}"`;
}

function assertServerName(value: string): void {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(
      'MCP server name may only contain letters, numbers, dot, underscore and hyphen.',
    );
  }
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
