/**
 * Parse Rocket.Chat rate-limit headers.
 *
 * Rocket.Chat sends `x-ratelimit-limit`, `x-ratelimit-remaining` and
 * `x-ratelimit-reset`. `reset` is a Unix timestamp in **milliseconds**. On a 429
 * we translate it into a relative `retryAfterMs` (never negative).
 */

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  /** Absolute reset time in epoch milliseconds, if provided. */
  resetAtMs?: number;
  /** Relative wait computed from `resetAtMs` and the supplied `now`. */
  retryAfterMs?: number;
}

/** Header accessor abstraction so we can accept `Headers` or a plain record. */
export interface HeaderLike {
  get(name: string): string | null;
}

function parseIntOrUndefined(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Extract rate-limit info from response headers.
 *
 * @param headers response headers
 * @param nowMs   current time in epoch ms (injected for deterministic tests)
 */
export function parseRateLimit(headers: HeaderLike, nowMs: number): RateLimitInfo {
  const info: RateLimitInfo = {};
  const limit = parseIntOrUndefined(headers.get('x-ratelimit-limit'));
  const remaining = parseIntOrUndefined(headers.get('x-ratelimit-remaining'));
  const reset = parseIntOrUndefined(headers.get('x-ratelimit-reset'));

  if (limit !== undefined) info.limit = limit;
  if (remaining !== undefined) info.remaining = remaining;

  if (reset !== undefined) {
    // Some proxies send reset in seconds; if the value looks like seconds
    // (i.e. small relative to "now" in ms), scale it up.
    const resetMs = reset < 1_000_000_000_000 ? reset * 1000 : reset;
    info.resetAtMs = resetMs;
    info.retryAfterMs = Math.max(0, resetMs - nowMs);
  }

  return info;
}
