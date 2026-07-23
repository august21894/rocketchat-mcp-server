#!/usr/bin/env node
/**
 * Interactive setup wizard: pick MCP client(s), enter the 3 required Rocket.Chat
 * env values, confirm, then write each client's config (with a .bak backup).
 *
 * This is an EXPLICIT command (never run from postinstall) so it is safe in CI
 * and non-interactive installs.
 */
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Prompter } from './prompt.js';
import { resolveAgents } from './agents.js';
import { applyToAgent } from './apply.js';
import { describeResult } from './result.js';
import type { McpServerDef } from './writers.js';

interface EnvField {
  key: string;
  label: string;
  desc: string;
  example: string;
  hidden: boolean;
  validate: (value: string) => string | null;
}

const ENV_FIELDS: EnvField[] = [
  {
    key: 'ROCKETCHAT_BASE_URL',
    label: 'Base URL',
    desc: 'URL workspace Rocket.Chat. Bắt buộc HTTPS (trừ localhost). Bỏ dấu "/" ở cuối.',
    example: 'https://chat.example.com',
    hidden: false,
    validate: validateUrl,
  },
  {
    key: 'ROCKETCHAT_USER_ID',
    label: 'Bot User ID',
    desc: 'User ID của bot account (gửi trong header X-User-Id). Lấy ở Admin → Users hoặc khi tạo PAT.',
    example: 'aB3xY7kQ9pLmN2rTs',
    hidden: false,
    validate: nonEmpty,
  },
  {
    key: 'ROCKETCHAT_AUTH_TOKEN',
    label: 'Auth Token (Personal Access Token)',
    desc: 'PAT của bot (header X-Auth-Token). GIỮ BÍ MẬT — nhập ẩn, sẽ lưu vào file cấu hình của agent.',
    example: 'k9dF2mQp...chuỗi-ngẫu-nhiên-dài',
    hidden: true,
    validate: nonEmpty,
  },
];

function nonEmpty(value: string): string | null {
  return value.trim() === '' ? 'Không được để trống.' : null;
}

function validateUrl(value: string): string | null {
  if (value.trim() === '') return 'Không được để trống.';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Không phải URL hợp lệ (vd https://chat.example.com).';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return 'Chỉ chấp nhận http/https.';
  }
  return null;
}

function maskSecret(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)} (đã ẩn)`;
}

function resolveServerPath(): string {
  // cli.js lives in dist/setup/, the server entry is dist/index.js.
  const hereDir = dirname(fileURLToPath(import.meta.url));
  return resolve(hereDir, '..', 'index.js');
}

async function main(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(
      'Setup cần chạy trong terminal tương tác. Hãy chạy trực tiếp:\n  rocketchat-mcp-setup\n',
    );
    process.exit(1);
  }

  const out = (s: string) => process.stdout.write(s + '\n');
  out('\n=== Rocket.Chat MCP — Setup ===\n');

  const serverPath = resolveServerPath();
  const nodePath = process.execPath;

  if (serverPath.includes('_npx')) {
    out(
      '⚠ Đang chạy từ cache npx (đường dẫn tạm). Cấu hình sẽ trỏ tới thư mục tạm và có thể bị xoá.\n' +
        '  Hãy dùng initializer ổn định: npm create rocketchat-mcp@latest\n',
    );
  }

  const agents = resolveAgents({
    platform: process.platform,
    homedir: homedir(),
    env: process.env,
  }).filter((a) => a.configPath !== null);

  const prompter = new Prompter();
  try {
    const chosenIds = await prompter.multiSelect(
      'Chọn (các) agent muốn thêm MCP này vào:',
      agents.map((a) => ({ value: a.id, label: `${a.label}  →  ${a.configPath}` })),
      agents.map((a) => a.id),
    );
    const chosen = agents.filter((a) => chosenIds.includes(a.id));
    if (chosen.length === 0) {
      out('Không chọn agent nào. Thoát.');
      return;
    }

    out('\nNhập 3 thông tin kết nối Rocket.Chat:\n');
    const env: Record<string, string> = {};
    for (const field of ENV_FIELDS) {
      out(`── ${field.key} (${field.label}) ──`);
      out(`   ${field.desc}`);
      out(`   Ví dụ: ${field.example}`);
      const value = field.hidden
        ? await promptHiddenRequired(prompter, field)
        : await prompter.askRequired(`   ${field.key} = `, field.validate);
      env[field.key] = value;
      out('');
    }

    // Confirmation summary.
    out('── Xác nhận ──');
    out('Agents sẽ được cấu hình:');
    for (const a of chosen) out(`  • ${a.label}  →  ${a.configPath}`);
    out('\nLệnh chạy server:');
    out(`  command: ${nodePath}`);
    out(`  args:    [${serverPath}]`);
    out('\nENV sẽ ghi vào cấu hình agent:');
    for (const field of ENV_FIELDS) {
      const shown = field.hidden ? maskSecret(env[field.key] ?? '') : env[field.key];
      out(`  ${field.key} = ${shown}`);
    }
    out('\n⚠ Auth Token sẽ được lưu dạng plaintext trong (các) file cấu hình ở trên.');

    const ok = await prompter.confirm('\nTiến hành ghi cấu hình?', false);
    if (!ok) {
      out('Đã huỷ. Không ghi gì.');
      return;
    }

    const def: McpServerDef = { command: nodePath, args: [serverPath], env };
    out('');
    for (const agent of chosen) {
      out(describeResult(agent, applyToAgent(agent, def)));
    }

    out('\nBước tiếp theo:');
    for (const agent of chosen) out(`  • ${agent.label}: ${agent.postNote}`);
    out('\nXong! ✅\n');
  } finally {
    prompter.close();
  }
}

async function promptHiddenRequired(prompter: Prompter, field: EnvField): Promise<string> {
  for (;;) {
    const value = (await prompter.askHidden(`   ${field.key} = `)).trim();
    const error = field.validate(value);
    if (error === null) return value;
    process.stdout.write(`  ✗ ${error}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Lỗi setup: ${String(error)}\n`);
  process.exit(1);
});
