/**
 * Minimal `.env` loader used as a FALLBACK source.
 *
 * Precedence: the system environment (`process.env`) ALWAYS wins. Values parsed
 * from a `.env` file are only used for keys that are not already set in the
 * environment. This is what makes the server usable both as a locally-cloned
 * project (with a `.env`) and as an installed npm package (with system env or a
 * `ROCKETCHAT_ENV_FILE` pointer), without ever letting a checked-in `.env`
 * override an explicitly-provided secret.
 *
 * No dependency on `dotenv`; interpolation/multiline are intentionally not
 * supported to keep behavior predictable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Parse `.env` file contents into a flat record (last occurrence wins). */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length).trim();

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    if (!KEY_PATTERN.test(key)) continue;

    let value = line.slice(eq + 1).trim();
    // Strip a single layer of matching quotes; unescape only inside "double".
    if (value.length >= 2 && value[0] === '"' && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (value.length >= 2 && value[0] === "'" && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export interface ResolveEnvOptions {
  /** Base environment (defaults to `process.env`). Always takes precedence. */
  env?: NodeJS.ProcessEnv;
  /** Explicit `.env` path. Defaults to `env.ROCKETCHAT_ENV_FILE` or `<cwd>/.env`. */
  path?: string;
  /** Base directory for the default `.env` lookup (defaults to `process.cwd()`). */
  cwd?: string;
  /** Sink for the "explicit env file not found" warning (defaults to stderr). */
  warn?: (message: string) => void;
}

/**
 * Build the effective environment: `.env` file values as a fallback, overlaid by
 * the system environment (which wins). Returns a new object; never mutates
 * `process.env` or the input.
 */
export function resolveEnv(options: ResolveEnvOptions = {}): NodeJS.ProcessEnv {
  const env = options.env ?? process.env;
  const explicitPath = options.path ?? env.ROCKETCHAT_ENV_FILE;
  const path = explicitPath ?? resolve(options.cwd ?? process.cwd(), '.env');

  let fromFile: Record<string, string> = {};
  if (existsSync(path)) {
    try {
      fromFile = parseDotEnv(readFileSync(path, 'utf8'));
    } catch {
      // Unreadable file: ignore and fall back to system env only.
    }
  } else if (explicitPath) {
    const warn = options.warn ?? ((m) => process.stderr.write(m + '\n'));
    warn(`Warning: ROCKETCHAT_ENV_FILE points to a missing file (ignored): ${explicitPath}`);
  }

  // System env overlaid last → it always wins over the .env fallback.
  return { ...fromFile, ...env };
}
