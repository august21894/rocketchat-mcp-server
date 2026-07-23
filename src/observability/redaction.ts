/**
 * Secret redaction utilities.
 *
 * Two layers of protection:
 *   1. Key-based redaction for structured objects (headers, config dumps).
 *   2. Value-based redaction that scrubs known secret literals from any string,
 *      so a token can never leak through an error message or nested value.
 */

export const REDACTED = '[REDACTED]';

/** Object keys whose values must always be redacted (case-insensitive). */
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|set-cookie|password|passwd|secret|token|x-auth-token|x-user-id|api[-_]?key)/i;

/**
 * A redactor bound to a set of known secret literals (e.g. the auth token).
 * Use one instance for the whole process so every log/error passes through it.
 */
export class Redactor {
  private readonly secrets: string[];

  constructor(secrets: Iterable<string> = []) {
    // Only redact non-trivial secrets; a 1-2 char "secret" would scrub half the
    // output. Sort by length desc so longer secrets are replaced first.
    this.secrets = Array.from(new Set(Array.from(secrets).filter((s) => s.length >= 4))).sort(
      (a, b) => b.length - a.length,
    );
  }

  /** Replace any occurrence of a known secret literal inside a string. */
  redactString(input: string): string {
    let output = input;
    for (const secret of this.secrets) {
      if (secret && output.includes(secret)) {
        output = output.split(secret).join(REDACTED);
      }
    }
    return output;
  }

  /**
   * Deep-redact an arbitrary value: sensitive keys are masked wholesale, and
   * every string (including keys' non-sensitive values) is scrubbed of secret
   * literals. Cycles are handled; functions/symbols are dropped.
   */
  redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
    if (typeof value === 'string') {
      return this.redactString(value);
    }
    if (value === null || typeof value !== 'object') {
      if (typeof value === 'bigint') return `${value}`;
      if (typeof value === 'function' || typeof value === 'symbol') return undefined;
      return value;
    }
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, seen));
    }
    if (value instanceof Error) {
      return { name: value.name, message: this.redactString(value.message) };
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : this.redact(val, seen);
    }
    return out;
  }
}

/** Convenience helper: does this key name look sensitive? */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}
