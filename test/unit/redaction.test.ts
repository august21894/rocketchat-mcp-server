import { describe, it, expect } from 'vitest';
import { Redactor, REDACTED, isSensitiveKey } from '../../src/observability/redaction.js';

describe('Redactor', () => {
  const token = 'super-secret-token-abcdef123456';
  const redactor = new Redactor([token]);

  it('scrubs a known secret literal from a string', () => {
    const out = redactor.redactString(`Authorization failed for ${token} today`);
    expect(out).not.toContain(token);
    expect(out).toContain(REDACTED);
  });

  it('masks sensitive keys wholesale', () => {
    const out = redactor.redact({
      'X-Auth-Token': token,
      authorization: 'Bearer x',
      cookie: 'a=b',
      password: 'hunter2',
      safe: 'value',
    }) as Record<string, unknown>;
    expect(out['X-Auth-Token']).toBe(REDACTED);
    expect(out.authorization).toBe(REDACTED);
    expect(out.cookie).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    expect(out.safe).toBe('value');
  });

  it('scrubs secrets nested inside non-sensitive fields', () => {
    const out = redactor.redact({ note: `the value is ${token}` }) as Record<string, unknown>;
    expect(out.note).not.toContain(token);
  });

  it('handles arrays, errors and cycles', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    const out = redactor.redact({
      list: [1, token, { token }],
      err: new Error(`boom ${token}`),
      cyclic,
    }) as Record<string, unknown>;
    const list = out.list as unknown[];
    expect(list[1]).toBe(REDACTED);
    expect((list[2] as Record<string, unknown>).token).toBe(REDACTED);
    expect((out.err as { message: string }).message).not.toContain(token);
  });

  it('ignores trivially short secrets', () => {
    const r = new Redactor(['ab']);
    expect(r.redactString('abcd')).toBe('abcd');
  });

  it('identifies sensitive keys', () => {
    expect(isSensitiveKey('x-auth-token')).toBe(true);
    expect(isSensitiveKey('API_KEY')).toBe(true);
    expect(isSensitiveKey('roomId')).toBe(false);
  });
});
