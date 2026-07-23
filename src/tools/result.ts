/**
 * Helpers for building MCP tool results with a final redaction pass.
 *
 * Tool results are returned directly to the MCP client (not through the logger),
 * so we run every payload through the {@link Redactor} here as a last line of
 * defense against a token or secret ever leaving the process.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { normalizeError } from '../rocketchat/errors.js';
import type { Redactor } from '../observability/redaction.js';

/** Build a successful result: JSON text content plus structured content. */
export function successResult(data: object, redactor: Redactor): CallToolResult {
  const redacted = redactor.redact(data) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: JSON.stringify(redacted, null, 2) }],
    structuredContent: redacted,
  };
}

/** Build a successful result with human-readable text plus structured content. */
export function successTextResult(data: object, text: string, redactor: Redactor): CallToolResult {
  const redacted = redactor.redact(data) as Record<string, unknown>;
  return {
    content: [{ type: 'text', text: redactor.redactString(text) }],
    structuredContent: redacted,
  };
}

/**
 * Build an error result from any thrown value. Sets `isError: true` and returns
 * only the sanitized error payload (no structuredContent, so no output-schema
 * validation is attempted).
 */
export function errorResult(error: unknown, redactor: Redactor): CallToolResult {
  const appError = normalizeError(error);
  const payload = redactor.redact(appError.toErrorPayload()) as Record<string, unknown>;
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}
