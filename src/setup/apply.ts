/**
 * Apply a server definition to an agent's config file on disk.
 *
 * Extracted from the CLI so the read → backup → merge → write flow can be unit
 * tested against a temp directory. Never clobbers an unparseable JSON file, and
 * never rewrites an existing Codex TOML block.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ResolvedAgent } from './agents.js';
import {
  upsertClaudeCodeReadOnlyPermissions,
  upsertCodexToml,
  upsertJsonMcpServer,
  type McpServerDef,
} from './writers.js';

export const SERVER_KEY = 'rocketchat';

export type ApplyStatus = 'added' | 'updated' | 'invalid-json' | 'exists-manual';

export interface ApplyResult {
  agentId: string;
  path: string;
  status: ApplyStatus;
  backupPath?: string;
}

export function applyToAgent(agent: ResolvedAgent, def: McpServerDef): ApplyResult {
  const path = agent.configPath;
  if (!path) {
    throw new Error(`Agent ${agent.id} has no config path on this platform.`);
  }
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : undefined;

  if (agent.kind === 'codex-toml') {
    const result = upsertCodexToml(existing, SERVER_KEY, def);
    if (result.alreadyExists) {
      return { agentId: agent.id, path, status: 'exists-manual' };
    }
    const backupPath = write(path, result.text, existing);
    return backupPath
      ? { agentId: agent.id, path, status: 'updated', backupPath }
      : { agentId: agent.id, path, status: 'added' };
  }

  let result;
  try {
    result = upsertJsonMcpServer(existing, SERVER_KEY, def);
    const permissionPath = agent.permissionConfigPath;
    const permissionExisting =
      permissionPath && existsSync(permissionPath)
        ? readFileSync(permissionPath, 'utf8')
        : undefined;
    const permissionText = permissionPath
      ? upsertClaudeCodeReadOnlyPermissions(permissionExisting, SERVER_KEY)
      : undefined;
    const backupPath = write(path, result.text, existing);
    if (permissionPath && permissionText) write(permissionPath, permissionText, permissionExisting);
    const status: ApplyStatus = result.replaced ? 'updated' : 'added';
    return backupPath
      ? { agentId: agent.id, path, status, backupPath }
      : { agentId: agent.id, path, status };
  } catch {
    return { agentId: agent.id, path, status: 'invalid-json' };
  }
}

/** Write `text` to `path`, backing up an existing file first. Returns backup path (if any). */
function write(path: string, text: string, existing: string | undefined): string | undefined {
  mkdirSync(dirname(path), { recursive: true });
  let backupPath: string | undefined;
  if (existing !== undefined) {
    backupPath = path + '.bak';
    copyFileSync(path, backupPath);
  }
  writeFileSync(path, text, 'utf8');
  return backupPath;
}
