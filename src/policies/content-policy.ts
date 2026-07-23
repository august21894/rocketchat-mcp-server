/**
 * Content policy — normalize and validate outbound message text.
 *
 *   - Normalize line endings to LF.
 *   - Strip control characters except tab and newline.
 *   - Enforce the configured maximum length on the caller-supplied text.
 *   - Reject empty text (attachment-only messages are out of scope for the MVP).
 */
import { AppError } from '../errors.js';
import type { AppConfig } from '../config/schema.js';

// Strip C0 controls except tab (U+0009) and newline (U+000A), plus DEL and the
// C1 range (U+007F-U+009F). CR is already normalized to LF before this runs, so
// U+000D is intentionally not in the strip set.
/* eslint-disable no-control-regex */
const CONTROL_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]',
  'g',
);
/* eslint-enable no-control-regex */

export class ContentPolicy {
  private readonly maxTextLength: number;

  constructor(config: Pick<AppConfig, 'maxTextLength'>) {
    this.maxTextLength = config.maxTextLength;
  }

  /**
   * Normalize and validate the caller-supplied text, returning the cleaned form
   * that will actually be sent. Throws `invalid_input` on empty/oversized text.
   */
  normalize(text: string): string {
    const normalizedNewlines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const cleaned = normalizedNewlines.replace(CONTROL_CHARS, '');

    if (cleaned.trim().length === 0) {
      throw new AppError('invalid_input', 'Message text must not be empty.', { retryable: false });
    }
    if (cleaned.length > this.maxTextLength) {
      throw new AppError(
        'invalid_input',
        `Message text exceeds the maximum length of ${this.maxTextLength} characters.`,
        { retryable: false, details: { length: cleaned.length, max: this.maxTextLength } },
      );
    }
    return cleaned;
  }
}
