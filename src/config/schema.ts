/**
 * Configuration schema and parsing.
 *
 * All runtime configuration comes from the environment; nothing here may be
 * overridden from a tool input. The parser fails fast with sanitized messages
 * and never echoes the token.
 */
import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from '../observability/logger.js';

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

/** Parse a string env value into a boolean, using `def` for empty/undefined. */
function envBoolean(def: boolean) {
  return z
    .preprocess(
      (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
      z.union([z.string(), z.undefined()]),
    )
    .transform((v, ctx): boolean => {
      if (v === undefined || v === '') return def;
      if (TRUE_VALUES.has(v)) return true;
      if (FALSE_VALUES.has(v)) return false;
      ctx.addIssue({ code: 'custom', message: 'must be a boolean (true/false)' });
      return z.NEVER;
    });
}

/** Parse a required, non-empty trimmed string. */
function requiredString(message: string) {
  return z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string({ message }).min(1, { message }),
  );
}

/** Parse a positive integer env value with a default. */
function envInt(def: number, opts: { min: number; max: number }) {
  return z
    .preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.union([z.string(), z.undefined()]))
    .transform((v, ctx): number => {
      if (v === undefined || v === '') return def;
      const n = Number(v);
      if (!Number.isInteger(n)) {
        ctx.addIssue({ code: 'custom', message: 'must be an integer' });
        return z.NEVER;
      }
      if (n < opts.min || n > opts.max) {
        ctx.addIssue({
          code: 'custom',
          message: `must be between ${opts.min} and ${opts.max}`,
        });
        return z.NEVER;
      }
      return n;
    });
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

/** Split a comma-separated env value into a trimmed, de-duplicated list. */
function csvList(v: string | undefined): string[] {
  if (!v) return [];
  return Array.from(
    new Set(
      v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

const csvSchema = z
  .preprocess((v) => (typeof v === 'string' ? v : ''), z.string())
  .transform(csvList);

const logLevelSchema = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : 'info'),
    z.enum(LOG_LEVELS),
  )
  .transform((v): LogLevel => v);

const workspaceNameSchema = z.preprocess(
  (v) => {
    if (typeof v !== 'string') return v;
    const trimmed = v.trim();
    return trimmed === '' ? undefined : trimmed;
  },
  z
    .string()
    .max(80, { message: 'must be at most 80 characters' })
    .refine((v) => !hasControlCharacters(v), {
      message: 'must not contain control characters',
    })
    .optional(),
);

const transportSchema = z
  .preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toLowerCase() : 'stdio'),
    z.literal('stdio', { message: 'only "stdio" transport is supported in the MVP' }),
  )
  .transform((v) => v);

/**
 * Validate and normalize the base URL: HTTPS is required, except for loopback
 * hosts (localhost / 127.0.0.1 / ::1) which may use HTTP for local development.
 * The returned value has any trailing slash removed.
 */
const baseUrlSchema = requiredString('ROCKETCHAT_BASE_URL is required').transform((raw, ctx) => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'must be a valid URL' });
    return z.NEVER;
  }
  const isLoopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    ctx.addIssue({
      code: 'custom',
      message: 'must use HTTPS (HTTP is only allowed for localhost)',
    });
    return z.NEVER;
  }
  // Normalize: strip trailing slash from the pathname/origin.
  const normalized = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  return normalized;
});

export const ConfigSchema = z
  .object({
    ROCKETCHAT_BASE_URL: baseUrlSchema,
    ROCKETCHAT_USER_ID: requiredString('ROCKETCHAT_USER_ID is required'),
    ROCKETCHAT_AUTH_TOKEN: requiredString('ROCKETCHAT_AUTH_TOKEN is required'),
    ROCKETCHAT_WORKSPACE_NAME: workspaceNameSchema,

    ROCKETCHAT_ALLOWED_ROOMS: csvSchema,
    ROCKETCHAT_ALLOW_DM: envBoolean(true),
    ROCKETCHAT_ALLOWED_DM_USERS: csvSchema,

    ROCKETCHAT_ALLOW_HERE_MENTION: envBoolean(true),
    ROCKETCHAT_ALLOW_ALL_MENTION: envBoolean(true),

    ROCKETCHAT_MAX_TEXT_LENGTH: envInt(10_000, { min: 1, max: 40_000 }),
    ROCKETCHAT_REQUEST_TIMEOUT_MS: envInt(10_000, { min: 1000, max: 120_000 }),
    ROCKETCHAT_DISABLE_URL_PREVIEW: envBoolean(true),

    MCP_TRANSPORT: transportSchema,
    LOG_LEVEL: logLevelSchema,
  })
  .transform((env) => ({
    baseUrl: env.ROCKETCHAT_BASE_URL,
    userId: env.ROCKETCHAT_USER_ID,
    authToken: env.ROCKETCHAT_AUTH_TOKEN,
    workspaceName: env.ROCKETCHAT_WORKSPACE_NAME ?? new URL(env.ROCKETCHAT_BASE_URL).hostname,
    allowedRooms: env.ROCKETCHAT_ALLOWED_ROOMS,
    allowDm: env.ROCKETCHAT_ALLOW_DM,
    allowedDmUsers: env.ROCKETCHAT_ALLOWED_DM_USERS,
    allowHereMention: env.ROCKETCHAT_ALLOW_HERE_MENTION,
    allowAllMention: env.ROCKETCHAT_ALLOW_ALL_MENTION,
    maxTextLength: env.ROCKETCHAT_MAX_TEXT_LENGTH,
    requestTimeoutMs: env.ROCKETCHAT_REQUEST_TIMEOUT_MS,
    disableUrlPreview: env.ROCKETCHAT_DISABLE_URL_PREVIEW,
    transport: env.MCP_TRANSPORT,
    logLevel: env.LOG_LEVEL,
  }));

export type AppConfig = z.infer<typeof ConfigSchema>;
