import type { ResolvedAgent } from './agents.js';
import { SERVER_KEY, type ApplyResult } from './apply.js';

/** Format a setup result without including connection values or secrets. */
export function describeResult(agent: ResolvedAgent, result: ApplyResult): string {
  const backup = result.backupPath ? ` (backup: ${result.backupPath})` : '';
  switch (result.status) {
    case 'added':
      return `✓ ${agent.label}: đã thêm "${SERVER_KEY}" → ${result.path}${backup}`;
    case 'updated':
      return `✓ ${agent.label}: đã cập nhật "${SERVER_KEY}" → ${result.path}${backup}`;
    case 'invalid-json':
      return `✗ ${agent.label}: ${result.path} không phải JSON hợp lệ — bỏ qua để tránh ghi đè.`;
    case 'exists-manual':
      return (
        `! ${agent.label}: đã có [mcp_servers.${SERVER_KEY}] trong ${result.path}. ` +
        'Không tự sửa để tránh hỏng TOML. Hãy cập nhật block hiện có thủ công ' +
        'hoặc xóa block đó rồi chạy lại setup.'
      );
  }
}
