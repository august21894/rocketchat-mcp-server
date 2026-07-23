import { describe, it, expect } from 'vitest';
import { IdempotencyService } from '../../src/services/idempotency-service.js';

describe('IdempotencyService', () => {
  it('derives a deterministic 17-char base62 message id', () => {
    const svc = new IdempotencyService();
    const a = svc.deriveMessageId('deploy-123');
    const b = svc.deriveMessageId('deploy-123');
    const c = svc.deriveMessageId('deploy-124');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(17);
    expect(a).toMatch(/^[0-9a-zA-Z]{17}$/);
  });

  it('tracks state transitions', () => {
    const svc = new IdempotencyService();
    expect(svc.get('k')).toBeUndefined();

    svc.markPending('k');
    expect(svc.get('k')?.state).toBe('pending');

    svc.markSucceeded('k', { messageId: 'm1', roomId: 'r1', timestamp: 't1' });
    expect(svc.get('k')?.state).toBe('succeeded');
    expect(svc.get('k')?.result).toEqual({ messageId: 'm1', roomId: 'r1', timestamp: 't1' });

    svc.markFailed('k');
    expect(svc.get('k')?.state).toBe('failed');
  });

  it('expires entries after the TTL', () => {
    let now = 1000;
    const svc = new IdempotencyService({ ttlMs: 500, now: () => now });
    svc.markPending('k');
    expect(svc.get('k')?.state).toBe('pending');
    now += 501;
    expect(svc.get('k')).toBeUndefined();
  });
});
