/**
 * A logger that discards output, for use in tests.
 */
import { createLogger, type Logger } from '../../src/observability/logger.js';
import { Redactor } from '../../src/observability/redaction.js';
import { TEST_TOKEN } from './config.js';

export function silentLogger(): Logger {
  return createLogger({
    level: 'error',
    redactor: new Redactor([TEST_TOKEN]),
    write: () => {},
  });
}
