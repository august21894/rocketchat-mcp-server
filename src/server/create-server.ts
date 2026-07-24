/**
 * Build the MCP server and register all tools.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import { registerTestConnectionTool } from '../tools/test-connection.js';
import { registerSearchUsersTool } from '../tools/search-users.js';
import { registerListRoomsTool } from '../tools/list-rooms.js';
import { registerPreviewMessageTool } from '../tools/preview-message.js';
import { registerSendMessageTool } from '../tools/send-message.js';
import { registerUploadFileTool } from '../tools/upload-file.js';
import { registerPreviewFileTool } from '../tools/preview-file.js';

export const SERVER_NAME = 'rocketchat-mcp-server';
export const SERVER_VERSION = '0.1.0';

export function createServer(ctx: AppContext): McpServer {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      description: `Rocket.Chat integration for ${ctx.config.workspaceName}`,
    },
    {
      instructions:
        `This server connects to the configured Rocket.Chat workspace ${workspace}. ` +
        `For every message send, always call rocketchat_preview_message first with the final ` +
        `destination and content. Copy the ENTIRE previewText field verbatim into the assistant ` +
        `response, including its first "Facon → destination" line and message body. Never display ` +
        `only renderedText, summarize, truncate, or replace the message with phrases such as ` +
        `"the original message". Only after displaying that complete preview, call ` +
        `rocketchat_send_message with the same message details and dryRun=false so the MCP client ` +
        `can show its approval controls. After a successful send, copy the tool's human-readable ` +
        `success text verbatim; it uses the recipient display name when available. If the user ` +
        `asked only for a preview, stop after ` +
        `rocketchat_preview_message and do not send. ` +
        `Use rocketchat_test_connection to verify its connection, rocketchat_search_users ` +
        `to resolve people, rocketchat_list_rooms to resolve destinations, and ` +
        `rocketchat_send_message whenever the user asks to send, message, notify or post ` +
        `something to ${workspace} or to the configured Rocket.Chat workspace. ` +
        `A clear user request to send with one resolved destination and message text is approval; ` +
        `do not ask for another conversational confirmation between preview and the MCP client's ` +
        `approval controls. For every file upload, always call rocketchat_preview_file first with ` +
        `the final destination, local file path and optional message details. This preview tool is ` +
        `read-only and should not require human approval. Copy its ENTIRE previewText field ` +
        `verbatim into the assistant response. Only after displaying that complete preview, call ` +
        `rocketchat_upload_file with the same file details and dryRun=false so the MCP client can ` +
        `show approval controls. If the user asked only for a file preview, stop after ` +
        `rocketchat_preview_file.`,
    },
  );

  registerTestConnectionTool(server, ctx);
  registerSearchUsersTool(server, ctx);
  registerListRoomsTool(server, ctx);
  registerPreviewMessageTool(server, ctx);
  registerSendMessageTool(server, ctx);
  registerPreviewFileTool(server, ctx);
  registerUploadFileTool(server, ctx);

  return server;
}
