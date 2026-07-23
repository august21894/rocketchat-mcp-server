/**
 * Load and validate configuration from the process environment.
 *
 * On failure the process must fail fast with a sanitized message. We deliberately
 * format Zod issues into `FIELD: message` lines and never include the offending
 * value, so a malformed token can never end up in a crash log.
 */
import type { ZodError } from 'zod';
import { ConfigSchema, type AppConfig } from './schema.js';

export type { AppConfig } from './schema.js';

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** Format Zod issues into safe `FIELD: message` strings (values omitted). */
function formatIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
}

/**
 * Parse configuration from an arbitrary env-like record. Throws {@link ConfigError}
 * with sanitized messages on any validation failure.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(formatIssues(result.error));
  }
  return result.data;
}
