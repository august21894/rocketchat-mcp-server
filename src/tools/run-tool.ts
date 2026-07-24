/**
 * Tool execution wrapper: correlation id, audit logging and uniform error
 * conversion. Handlers focus on business logic and may throw {@link AppError};
 * this wrapper turns any throw into a sanitized error result.
 */
import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { AppContext } from '../container.js';
import type { Logger } from '../observability/logger.js';
import { normalizeError } from '../rocketchat/errors.js';
import { errorResult } from './result.js';

export type ToolHandler = (log: Logger) => Promise<CallToolResult>;

export async function runTool(
  ctx: AppContext,
  toolName: string,
  handler: ToolHandler,
): Promise<CallToolResult> {
  const correlationId = randomUUID();
  const log = ctx.logger.child({ tool: toolName, correlationId });
  const startedAt = Date.now();
  log.info('tool.start');
  try {
    const result = await handler(log);
    log.info('tool.finish', {
      durationMs: Date.now() - startedAt,
      isError: result.isError === true,
    });
    return result;
  } catch (error) {
    const appError = normalizeError(error, { tool: toolName });
    log.warn('tool.error', {
      durationMs: Date.now() - startedAt,
      code: appError.code,
      retryable: appError.retryable,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    });
    return errorResult(appError, ctx.redactor);
  }
}
