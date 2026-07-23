import { describe, it, expect } from 'vitest';
import { parseRateLimit } from '../../src/rocketchat/rate-limit.js';

function headers(map: Record<string, string>) {
  return {
    get: (name: string) => map[name.toLowerCase()] ?? null,
  };
}

describe('parseRateLimit', () => {
  const now = 1_700_000_000_000; // fixed epoch ms (2023), realistic magnitude

  it('parses limit, remaining and a millisecond reset', () => {
    const info = parseRateLimit(
      headers({
        'x-ratelimit-limit': '60',
        'x-ratelimit-remaining': '5',
        'x-ratelimit-reset': String(now + 3000),
      }),
      now,
    );
    expect(info.limit).toBe(60);
    expect(info.remaining).toBe(5);
    expect(info.resetAtMs).toBe(now + 3000);
    expect(info.retryAfterMs).toBe(3000);
  });

  it('scales a seconds-based reset up to milliseconds', () => {
    const resetSeconds = Math.floor(now / 1000) + 2;
    const info = parseRateLimit(headers({ 'x-ratelimit-reset': String(resetSeconds) }), now);
    expect(info.retryAfterMs).toBe(2000);
  });

  it('never returns a negative retryAfterMs', () => {
    const info = parseRateLimit(headers({ 'x-ratelimit-reset': String(now - 5000) }), now);
    expect(info.retryAfterMs).toBe(0);
  });

  it('returns an empty object when no headers are present', () => {
    expect(parseRateLimit(headers({}), now)).toEqual({});
  });
});
