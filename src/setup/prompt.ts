/**
 * Tiny zero-dependency interactive prompt helpers built on node:readline.
 * Keeping this dependency-free matters for a widely-installed CLI.
 */
import { createInterface, type Interface } from 'node:readline';

export interface SelectOption {
  value: string;
  label: string;
}

export class Prompter {
  private readonly rl: Interface;
  private muted = false;

  constructor() {
    this.rl = createInterface({ input: process.stdin, output: process.stdout });
    // Override echo so we can mask hidden (secret) input. Arrow fn captures `this`.
    (this.rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (
      s: string,
    ) => {
      if (!this.muted) process.stdout.write(s);
    };
  }

  private ask(query: string): Promise<string> {
    return new Promise((resolve) => this.rl.question(query, resolve));
  }

  /** Ask a question, re-asking until `validate` returns null (no error). */
  async askRequired(
    query: string,
    validate: (value: string) => string | null = defaultRequired,
  ): Promise<string> {
    for (;;) {
      const answer = (await this.ask(query)).trim();
      const error = validate(answer);
      if (error === null) return answer;
      process.stdout.write(`  ✗ ${error}\n`);
    }
  }

  /** Ask for a secret; keystrokes are not echoed. */
  askHidden(query: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(query, (value) => {
        this.muted = false;
        process.stdout.write('\n');
        resolve(value.trim());
      });
      this.muted = true;
    });
  }

  async confirm(query: string, defaultYes = false): Promise<boolean> {
    const suffix = defaultYes ? ' [Y/n] ' : ' [y/N] ';
    const answer = (await this.ask(query + suffix)).trim().toLowerCase();
    if (answer === '') return defaultYes;
    return answer === 'y' || answer === 'yes';
  }

  /**
   * Multi-select from a numbered list. Accepts e.g. "1,3", "1 3", "all", or empty
   * for the provided default. Returns the selected option values.
   */
  async multiSelect(
    title: string,
    options: SelectOption[],
    defaultValues: string[] = [],
  ): Promise<string[]> {
    process.stdout.write(`${title}\n`);
    options.forEach((opt, i) => {
      process.stdout.write(`  ${i + 1}) ${opt.label}\n`);
    });
    const defaultHint =
      defaultValues.length > 0
        ? options
            .map((o, i) => (defaultValues.includes(o.value) ? i + 1 : null))
            .filter((n): n is number => n !== null)
            .join(',')
        : 'all';

    for (;;) {
      const raw = (
        await this.ask(`Chọn (vd "1,3" hoặc "all") [mặc định: ${defaultHint}]: `)
      ).trim();

      if (raw === '') {
        return defaultValues.length > 0 ? defaultValues : options.map((o) => o.value);
      }
      if (raw.toLowerCase() === 'all') {
        return options.map((o) => o.value);
      }

      const indices = raw
        .split(/[\s,]+/)
        .filter((s) => s !== '')
        .map((s) => Number(s));
      const valid =
        indices.length > 0 &&
        indices.every((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
      if (!valid) {
        process.stdout.write('  ✗ Lựa chọn không hợp lệ.\n');
        continue;
      }
      const chosen = Array.from(new Set(indices)).map((n) => options[n - 1]!.value);
      return chosen;
    }
  }

  close(): void {
    this.rl.close();
  }
}

function defaultRequired(value: string): string | null {
  return value.trim() === '' ? 'Không được để trống.' : null;
}
