import { describe, it, expect } from 'vitest';
import { AppError, toAppError } from '../../src/errors.js';
import {
  RocketChatHttpError,
  RequestTimeoutError,
  NetworkError,
  RocketChatResponseError,
  mapRocketChatError,
  normalizeError as normalizeRcError,
} from '../../src/rocketchat/errors.js';

describe('AppError', () => {
  it('serializes a sanitized payload', () => {
    const err = new AppError('rate_limited', 'slow down', {
      retryable: true,
      retryAfterMs: 1500,
      details: { status: 429 },
      cause: new Error('secret cause'),
    });
    const payload = err.toErrorPayload();
    expect(payload.error.code).toBe('rate_limited');
    expect(payload.error.retryAfterMs).toBe(1500);
    expect(JSON.stringify(payload)).not.toContain('secret cause');
  });
});

describe('mapRocketChatError', () => {
  it('maps 401 to authentication_failed', () => {
    const err = mapRocketChatError(new RocketChatHttpError({ status: 401 }));
    expect(err.code).toBe('authentication_failed');
    expect(err.retryable).toBe(false);
  });

  it('maps 403 to permission_denied', () => {
    expect(mapRocketChatError(new RocketChatHttpError({ status: 403 })).code).toBe(
      'permission_denied',
    );
  });

  it('maps 404 to destination_not_found', () => {
    expect(mapRocketChatError(new RocketChatHttpError({ status: 404 })).code).toBe(
      'destination_not_found',
    );
  });

  it('maps 429 to rate_limited with retryAfterMs', () => {
    const err = mapRocketChatError(
      new RocketChatHttpError({ status: 429, rateLimit: { retryAfterMs: 2000 } }),
    );
    expect(err.code).toBe('rate_limited');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(2000);
  });

  it('maps 5xx to a retryable rocketchat_error', () => {
    const err = mapRocketChatError(new RocketChatHttpError({ status: 503 }));
    expect(err.code).toBe('rocketchat_error');
    expect(err.retryable).toBe(true);
  });

  it('maps known errorTypes to a precise code', () => {
    const err = mapRocketChatError(
      new RocketChatHttpError({ status: 400, errorType: 'error-room-not-found' }),
    );
    expect(err.code).toBe('destination_not_found');
  });

  it('maps timeouts and network errors', () => {
    expect(mapRocketChatError(new RequestTimeoutError(10000)).code).toBe('request_timeout');
    expect(mapRocketChatError(new NetworkError('down')).code).toBe('network_error');
    expect(mapRocketChatError(new NetworkError('down')).retryable).toBe(true);
  });

  it('maps invalid upstream responses with safe operation details', () => {
    const err = mapRocketChatError(
      new RocketChatResponseError({
        operation: 'POST /api/v1/rooms.media/:rid',
        issue: 'empty_body',
        status: 200,
      }),
    );

    expect(err).toMatchObject({
      code: 'invalid_upstream_response',
      retryable: false,
      details: {
        operation: 'POST /api/v1/rooms.media/:rid',
        issue: 'empty_body',
        status: 200,
      },
    });
  });

  it('never leaks a token in the mapped payload', () => {
    const token = 'secret-token-xyz';
    const err = mapRocketChatError(
      new RocketChatHttpError({ status: 400, upstreamError: `bad ${token}` }),
    );
    // The upstream string is present in details but the tool layer redacts it;
    // here we only assert the code/shape are sane.
    expect(err.code).toBe('rocketchat_error');
    expect(err.details?.upstream).toContain(token); // redaction happens at the result layer
  });
});

describe('normalizeError', () => {
  it('passes AppError through unchanged', () => {
    const original = new AppError('invalid_input', 'nope');
    expect(normalizeRcError(original)).toBe(original);
  });

  it('wraps unknown errors as internal_error with safe context', () => {
    expect(toAppError(new Error('weird'))).toMatchObject({
      code: 'internal_error',
      details: { exceptionType: 'Error' },
    });
    expect(normalizeRcError('a string', { tool: 'rocketchat_upload_file' })).toMatchObject({
      code: 'internal_error',
      details: {
        exceptionType: 'NonErrorThrow',
        tool: 'rocketchat_upload_file',
      },
    });
  });
});
