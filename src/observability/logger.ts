/**
 * Structured JSON logger that writes to **stderr only**.
 *
 * The MCP stdio transport owns stdout, so any application log written there
 * would corrupt the protocol stream. Every line here goes to stderr as a single
 * JSON object and is passed through the {@link Redactor} first.
 */
import type { Redactor } from './redaction.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, unknown>;

export interface Logger {
  readonly level: LogLevel;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Return a child logger whose fields are merged into every entry. */
  child(bindings: LogFields): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  redactor: Redactor;
  /** Injectable sink (defaults to stderr); handy for tests. */
  write?: (line: string) => void;
  /** Injectable clock (defaults to Date); handy for deterministic tests. */
  now?: () => Date;
  bindings?: LogFields;
}

class JsonLogger implements Logger {
  readonly level: LogLevel;
  private readonly redactor: Redactor;
  private readonly write: (line: string) => void;
  private readonly now: () => Date;
  private readonly bindings: LogFields;

  constructor(options: LoggerOptions) {
    this.level = options.level;
    this.redactor = options.redactor;
    this.write = options.write ?? ((line) => process.stderr.write(line + '\n'));
    this.now = options.now ?? (() => new Date());
    this.bindings = options.bindings ?? {};
  }

  private log(level: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) {
      return;
    }
    const entry = {
      time: this.now().toISOString(),
      level,
      msg: message,
      ...this.bindings,
      ...(fields ?? {}),
    };
    const redacted = this.redactor.redact(entry);
    this.write(JSON.stringify(redacted));
  }

  debug(message: string, fields?: LogFields): void {
    this.log('debug', message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.log('info', message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.log('warn', message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.log('error', message, fields);
  }

  child(bindings: LogFields): Logger {
    const options: LoggerOptions = {
      level: this.level,
      redactor: this.redactor,
      write: this.write,
      now: this.now,
      bindings: { ...this.bindings, ...bindings },
    };
    return new JsonLogger(options);
  }
}

export function createLogger(options: LoggerOptions): Logger {
  return new JsonLogger(options);
}
