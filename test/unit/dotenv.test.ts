import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDotEnv, resolveEnv } from '../../src/config/dotenv.js';

const tmpFiles: string[] = [];

function writeEnvFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rc-env-'));
  const file = join(dir, '.env');
  writeFileSync(file, content, 'utf8');
  tmpFiles.push(dir);
  return file;
}

afterEach(() => {
  for (const dir of tmpFiles.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parseDotEnv', () => {
  it('parses simple key/value pairs', () => {
    expect(parseDotEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
  });

  it('ignores blank lines and comments', () => {
    expect(parseDotEnv('# comment\n\nA=1\n   # indented comment\nB=2')).toEqual({ A: '1', B: '2' });
  });

  it('supports the export prefix', () => {
    expect(parseDotEnv('export TOKEN=abc')).toEqual({ TOKEN: 'abc' });
  });

  it('keeps "=" inside values', () => {
    expect(parseDotEnv('URL=https://a.b/?x=1&y=2')).toEqual({ URL: 'https://a.b/?x=1&y=2' });
  });

  it('strips matching quotes and unescapes double quotes', () => {
    expect(parseDotEnv('A="he\\"llo"\nB=\'raw\'')).toEqual({ A: 'he"llo', B: 'raw' });
  });

  it('skips malformed keys/lines', () => {
    expect(parseDotEnv('123=x\nnoequals\nGOOD=y')).toEqual({ GOOD: 'y' });
  });
});

describe('resolveEnv', () => {
  it('uses .env values as a fallback for unset keys', () => {
    const path = writeEnvFile('ROCKETCHAT_USER_ID=from-file\nONLY_IN_FILE=xyz');
    const merged = resolveEnv({ env: { EXISTING: 'sys' }, path });
    expect(merged.ROCKETCHAT_USER_ID).toBe('from-file');
    expect(merged.ONLY_IN_FILE).toBe('xyz');
    expect(merged.EXISTING).toBe('sys');
  });

  it('lets the system environment win over .env', () => {
    const path = writeEnvFile('ROCKETCHAT_AUTH_TOKEN=from-file\nROCKETCHAT_BASE_URL=https://file');
    const merged = resolveEnv({
      env: { ROCKETCHAT_AUTH_TOKEN: 'from-system' },
      path,
    });
    expect(merged.ROCKETCHAT_AUTH_TOKEN).toBe('from-system'); // system wins
    expect(merged.ROCKETCHAT_BASE_URL).toBe('https://file'); // fallback used
  });

  it('does not mutate the input env', () => {
    const path = writeEnvFile('ONLY_IN_FILE=xyz');
    const env = { A: '1' };
    resolveEnv({ env, path });
    expect(env).toEqual({ A: '1' });
  });

  it('returns system env unchanged when no .env file exists', () => {
    const merged = resolveEnv({ env: { A: '1' }, path: '/nonexistent/path/.env', warn: () => {} });
    expect(merged).toEqual({ A: '1' });
  });

  it('warns when an explicit env file path is missing', () => {
    const warnings: string[] = [];
    resolveEnv({ env: { A: '1' }, path: '/nope/.env', warn: (m) => warnings.push(m) });
    expect(warnings[0]).toMatch(/missing file/);
  });
});
