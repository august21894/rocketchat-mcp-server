/**
 * Shared MCP tool annotation presets.
 *
 * `openWorldHint: true` for all tools because they interact with an external
 * Rocket.Chat workspace. Only `send_message` is a non-read-only, side-effecting
 * tool.
 */
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export const READ_ONLY_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
};

export const SEND_MESSAGE_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: true,
};
