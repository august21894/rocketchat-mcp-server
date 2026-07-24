/**
 * Internal, transport-agnostic error model.
 *
 * Every tool converts failures into a structured payload built from an
 * {@link AppError}. Error payloads returned to the model MUST NOT contain
 * tokens, headers or raw stack traces (see the security section of the plan).
 */

export const ERROR_CODES = [
  'invalid_input',
  'authentication_failed',
  'permission_denied',
  'destination_not_allowed',
  'destination_not_found',
  'ambiguous_destination',
  'mention_not_allowed',
  'thread_room_mismatch',
  'encrypted_room_not_supported',
  'rate_limited',
  'request_timeout',
  'network_error',
  'invalid_upstream_response',
  'duplicate_request',
  'unknown_delivery_state',
  'rocketchat_error',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorOptions {
  /** Whether the caller may retry the same request. */
  retryable?: boolean;
  /** Suggested wait time before retrying, in milliseconds. */
  retryAfterMs?: number;
  /** Non-sensitive structured details safe to expose to the model. */
  details?: Record<string, unknown>;
  /** Underlying cause, kept for internal logging only (never serialized). */
  cause?: unknown;
}

/**
 * A structured, sanitized application error. The message and details are safe
 * to hand back to an MCP client; the {@link AppError.cause} is for logs only.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.details = options.details;
  }

  /**
   * The sanitized JSON body returned inside a tool's error result. Contains no
   * token, header or stack trace.
   */
  toErrorPayload(): ToolErrorPayload {
    const payload: ToolErrorPayload = {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
      },
    };
    if (this.retryAfterMs !== undefined) {
      payload.error.retryAfterMs = this.retryAfterMs;
    }
    if (this.details !== undefined) {
      payload.error.details = this.details;
    }
    return payload;
  }
}

export interface ToolErrorPayload {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
    details?: Record<string, unknown>;
  };
}

/** Narrow an unknown thrown value to an {@link AppError}. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Coerce any thrown value into an {@link AppError}. Unknown errors are mapped to
 * `internal_error` without leaking their message content, since we cannot
 * guarantee an arbitrary error string is free of secrets.
 */
export function toAppError(value: unknown): AppError {
  if (isAppError(value)) {
    return value;
  }
  return new AppError('internal_error', 'An unexpected internal error occurred.', {
    retryable: false,
    details: { exceptionType: safeExceptionType(value) },
    cause: value,
  });
}

export function safeExceptionType(value: unknown): string {
  if (!(value instanceof Error)) return 'NonErrorThrow';
  const safeNames = new Set([
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'URIError',
    'AggregateError',
  ]);
  return safeNames.has(value.name) ? value.name : 'Error';
}
