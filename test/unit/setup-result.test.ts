import { describe, expect, it } from 'vitest';
import type { ResolvedAgent } from '../../src/setup/agents.js';
import type { ApplyResult } from '../../src/setup/apply.js';
import { describeResult } from '../../src/setup/result.js';

const AGENT: ResolvedAgent = {
  id: 'codex',
  label: 'Codex CLI',
  kind: 'codex-toml',
  configPath: '/tmp/config.toml',
  postNote: '',
};

describe('describeResult', () => {
  it('does not print arbitrary replacement data for an existing Codex block', () => {
    const secret = 'regression-secret-token';
    const result = {
      agentId: 'codex',
      path: '/tmp/config.toml',
      status: 'exists-manual',
      // Simulate the old result shape to prevent a future formatter regression.
      block: `[mcp_servers.rocketchat.env]\nROCKETCHAT_AUTH_TOKEN = "${secret}"`,
    } as ApplyResult & { block: string };

    const output = describeResult(AGENT, result);

    expect(output).not.toContain(secret);
    expect(output).not.toContain('ROCKETCHAT_AUTH_TOKEN');
    expect(output).toContain('Không tự sửa');
  });
});
