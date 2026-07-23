/**
 * Idempotency service — an in-memory TTL store that prevents double-sends within
 * a single process.
 *
 * LIMITATION (documented in docs/security.md): state is lost on restart and is
 * NOT shared across instances. Cross-restart protection is provided at the
 * Rocket.Chat layer by sending `chat.sendMessage` with a deterministic `_id`
 * derived from the idempotency key — Rocket.Chat rejects a duplicate `_id`.
 * Before a remote/multi-instance deployment, replace this with Redis or another
 * shared persistent store.
 */
import { createHash } from 'node:crypto';

export type IdempotencyState = 'pending' | 'succeeded' | 'failed';

export interface StoredResult {
  messageId: string;
  roomId: string;
  timestamp: string;
}

interface Entry {
  state: IdempotencyState;
  expiresAtMs: number;
  result?: StoredResult;
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const RC_ID_LENGTH = 17;

export interface IdempotencyServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

export class IdempotencyService {
  private readonly store = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: IdempotencyServiceOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Derive a stable, Rocket.Chat-compatible message `_id` (17 chars, base62)
   * from an idempotency key. Deterministic across processes.
   */
  deriveMessageId(key: string): string {
    const digest = createHash('sha256').update(key).digest();
    let out = '';
    for (let i = 0; i < RC_ID_LENGTH; i += 1) {
      out += ID_ALPHABET[digest[i]! % ID_ALPHABET.length];
    }
    return out;
  }

  private prune(nowMs: number): void {
    for (const [key, entry] of this.store) {
      if (entry.expiresAtMs <= nowMs) {
        this.store.delete(key);
      }
    }
  }

  /** Current entry for a key, or `undefined` if absent/expired. */
  get(key: string): Entry | undefined {
    const nowMs = this.now();
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= nowMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  /** Mark a key as in-flight. */
  markPending(key: string): void {
    const nowMs = this.now();
    this.prune(nowMs);
    this.store.set(key, { state: 'pending', expiresAtMs: nowMs + this.ttlMs });
  }

  /** Record a successful delivery. */
  markSucceeded(key: string, result: StoredResult): void {
    this.store.set(key, {
      state: 'succeeded',
      result,
      expiresAtMs: this.now() + this.ttlMs,
    });
  }

  /** Record a failed attempt (the key may be retried). */
  markFailed(key: string): void {
    this.store.set(key, { state: 'failed', expiresAtMs: this.now() + this.ttlMs });
  }
}
