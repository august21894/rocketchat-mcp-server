/**
 * Rocket.Chat HTTP error handling and mapping to the internal error model.
 */
import { AppError, isAppError, safeExceptionType, type ErrorCode } from '../errors.js';
import type { RateLimitInfo } from './rate-limit.js';

/**
 * Raised by {@link RocketChatClient} when the upstream returns a non-2xx status
 * or a `success: false` body. Carries only sanitizable fields.
 */
export class RocketChatHttpError extends Error {
  readonly status: number;
  readonly upstreamError: string | undefined;
  readonly errorType: string | undefined;
  readonly rateLimit: RateLimitInfo | undefined;
  readonly operation: string | undefined;

  constructor(args: {
    status: number;
    upstreamError?: string;
    errorType?: string;
    rateLimit?: RateLimitInfo;
    operation?: string;
  }) {
    super(`Rocket.Chat responded with HTTP ${args.status}`);
    this.name = 'RocketChatHttpError';
    this.status = args.status;
    this.upstreamError = args.upstreamError;
    this.errorType = args.errorType;
    this.rateLimit = args.rateLimit;
    this.operation = args.operation;
  }
}

/** Raised when a request exceeds the configured timeout. */
export class RequestTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly operation: string | undefined;
  constructor(timeoutMs: number, operation?: string) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }
}

/** Raised on a transport/network failure (DNS, connection reset, etc.). */
export class NetworkError extends Error {
  readonly operation: string | undefined;
  constructor(message: string, options?: { cause?: unknown; operation?: string }) {
    super(message, options);
    this.name = 'NetworkError';
    this.operation = options?.operation;
  }
}

/** Raised when a successful HTTP response violates the expected API contract. */
export class RocketChatResponseError extends Error {
  readonly operation: string;
  readonly issue: 'empty_body' | 'invalid_json' | 'missing_required_fields';
  readonly status: number | undefined;

  constructor(args: {
    operation: string;
    issue: 'empty_body' | 'invalid_json' | 'missing_required_fields';
    status?: number;
  }) {
    super(`Rocket.Chat returned an invalid response for ${args.operation}`);
    this.name = 'RocketChatResponseError';
    this.operation = args.operation;
    this.issue = args.issue;
    this.status = args.status;
  }
}

export interface ErrorContext {
  tool?: string;
}

/** RC `errorType` values that map to a more specific internal code. */
const ERROR_TYPE_MAP: Record<string, ErrorCode> = {
  'error-invalid-room': 'destination_not_found',
  'error-room-not-found': 'destination_not_found',
  'error-invalid-user': 'destination_not_found',
  'error-not-allowed': 'permission_denied',
  'error-not-authorized': 'permission_denied',
  'error-no-permission': 'permission_denied',
  'error-user-not-in-room': 'permission_denied',
};

function truncate(value: string, max = 300): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Convert any error thrown by the client into a sanitized {@link AppError}.
 * The resulting message/details are safe to hand to the model.
 */
export function mapRocketChatError(error: unknown, context: ErrorContext = {}): AppError {
  if (error instanceof RequestTimeoutError) {
    const details: Record<string, unknown> = { timeoutMs: error.timeoutMs };
    if (error.operation) details.operation = error.operation;
    return new AppError('request_timeout', 'The Rocket.Chat request timed out.', {
      retryable: true,
      details,
      cause: error,
    });
  }

  if (error instanceof NetworkError) {
    const details: Record<string, unknown> = {};
    if (error.operation) details.operation = error.operation;
    return new AppError('network_error', 'Could not reach the Rocket.Chat server.', {
      retryable: true,
      ...(Object.keys(details).length > 0 ? { details } : {}),
      cause: error,
    });
  }

  if (error instanceof RocketChatHttpError) {
    return mapHttpError(error);
  }

  if (error instanceof RocketChatResponseError) {
    const details: Record<string, unknown> = {
      operation: error.operation,
      issue: error.issue,
    };
    if (error.status !== undefined) details.status = error.status;
    return new AppError(
      'invalid_upstream_response',
      `Rocket.Chat returned an invalid response for ${error.operation}.`,
      {
        retryable: false,
        details,
        cause: error,
      },
    );
  }

  const details: Record<string, unknown> = {
    exceptionType: safeExceptionType(error),
  };
  if (context.tool) details.tool = context.tool;
  return new AppError('internal_error', 'An unexpected internal error occurred.', {
    retryable: false,
    details,
    cause: error,
  });
}

/**
 * Normalize ANY thrown value into a sanitized {@link AppError}. Existing
 * AppErrors pass through unchanged; Rocket.Chat/network/timeout errors are
 * mapped; everything else becomes a sanitized `internal_error`.
 */
export function normalizeError(error: unknown, context: ErrorContext = {}): AppError {
  if (isAppError(error)) {
    if (!context.tool || error.details?.tool !== undefined) return error;
    return new AppError(error.code, error.message, {
      retryable: error.retryable,
      ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
      details: { ...(error.details ?? {}), tool: context.tool },
      cause: error.cause,
    });
  }
  return mapRocketChatError(error, context);
}

function mapHttpError(error: RocketChatHttpError): AppError {
  const details: Record<string, unknown> = { status: error.status };
  if (error.operation) details.operation = error.operation;
  if (error.errorType) details.errorType = error.errorType;
  if (error.upstreamError) details.upstream = truncate(error.upstreamError);

  switch (error.status) {
    case 401:
      return new AppError('authentication_failed', 'Rocket.Chat rejected the credentials.', {
        retryable: false,
        details,
        cause: error,
      });
    case 403:
      return new AppError(
        'permission_denied',
        'The bot lacks permission for this Rocket.Chat operation.',
        { retryable: false, details, cause: error },
      );
    case 404:
      return new AppError(
        'destination_not_found',
        'The requested Rocket.Chat resource was not found.',
        {
          retryable: false,
          details,
          cause: error,
        },
      );
    case 429: {
      const opts: {
        retryable: boolean;
        details: Record<string, unknown>;
        cause: unknown;
        retryAfterMs?: number;
      } = { retryable: true, details, cause: error };
      if (error.rateLimit?.retryAfterMs !== undefined) {
        opts.retryAfterMs = error.rateLimit.retryAfterMs;
      }
      return new AppError('rate_limited', 'Rocket.Chat rate limit exceeded.', opts);
    }
    default: {
      // Map known errorTypes on 400-class responses to a more precise code.
      if (error.errorType && ERROR_TYPE_MAP[error.errorType]) {
        const code = ERROR_TYPE_MAP[error.errorType]!;
        return new AppError(code, 'Rocket.Chat rejected the request.', {
          retryable: false,
          details,
          cause: error,
        });
      }
      const retryable = error.status >= 500;
      return new AppError('rocketchat_error', 'Rocket.Chat returned an error.', {
        retryable,
        details,
        cause: error,
      });
    }
  }
}
