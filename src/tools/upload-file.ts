/** `rocketchat_upload_file` — safely upload one local file to one room. */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import type { Logger } from '../observability/logger.js';
import type { DestinationSummary } from '../services/message-service.js';
import type { UploadFileResult } from '../services/upload-file-service.js';
import { WRITE_ANNOTATIONS } from '../server/tool-annotations.js';
import { MESSAGE_INPUT_SHAPE } from './send-message.js';
import { runTool } from './run-tool.js';
import { successTextResult } from './result.js';

export const FILE_INPUT_SHAPE = {
  target: MESSAGE_INPUT_SHAPE.target,
  filePath: z
    .string()
    .min(1)
    .max(4096)
    .describe('Local file path. It must be inside ROCKETCHAT_ALLOWED_UPLOAD_PATHS.'),
  description: z.string().min(1).nullable().default(null),
  message: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe('Optional message shown with the file. The MCP adds the AI icon.'),
  threadMessageId: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe('Optional parent message id; it must belong to the destination room.'),
};

const INPUT_SHAPE = {
  ...FILE_INPUT_SHAPE,
  dryRun: z
    .boolean()
    .default(true)
    .describe(
      'Backward-compatible dry run. The preferred preview workflow uses rocketchat_preview_file.',
    ),
};

export const FILE_DESTINATION_SHAPE = z.object({
  roomId: z.string().optional(),
  type: z.enum(['channel', 'private_room', 'direct']),
  name: z.string(),
  displayName: z.string().optional(),
  recipientUsername: z.string().optional(),
});

export const FILE_RESULT_SHAPE = z.object({
  id: z.string().optional(),
  url: z.string().optional(),
  name: z.string(),
  size: z.number(),
  contentType: z.string(),
});

const OUTPUT_SHAPE = {
  uploaded: z.boolean(),
  preview: z.boolean(),
  destination: FILE_DESTINATION_SHAPE,
  file: FILE_RESULT_SHAPE,
  description: z.string().optional(),
  renderedMessage: z.string().optional(),
  message: z.object({ id: z.string(), roomId: z.string(), timestamp: z.string() }).optional(),
};

function destinationLabel(destination: DestinationSummary): string {
  if (destination.type === 'direct') {
    const username = destination.recipientUsername ?? destination.name;
    const handle = username.startsWith('@') ? username : `@${username}`;
    return destination.displayName ? `${destination.displayName} (${handle})` : handle;
  }
  const roomName = destination.displayName ?? destination.name;
  return roomName.startsWith('#') ? roomName : `#${roomName}`;
}

export function humanFileResult(workspaceName: string, result: UploadFileResult): string {
  const destination = destinationLabel(result.destination);
  if (!result.uploaded) {
    const lines = [
      `📎 **${workspaceName} → ${destination}**`,
      '',
      `File: ${result.file.name} (${result.file.size} bytes, ${result.file.contentType})`,
    ];
    if (result.renderedMessage) lines.push(`Message: ${result.renderedMessage}`);
    if (result.description) lines.push(`Description: ${result.description}`);
    return lines.join('\n');
  }
  return `✅ Đã tải file ${result.file.name} lên ${destination}.`;
}

function auditFields(args: {
  target: { type: string };
  dryRun: boolean;
  result: UploadFileResult;
}): Record<string, unknown> {
  return {
    targetType: args.target.type,
    dryRun: args.dryRun,
    uploaded: args.result.uploaded,
    roomId: args.result.destination.roomId,
    fileName: args.result.file.name,
    fileSize: args.result.file.size,
    ...(args.result.uploaded
      ? { fileId: args.result.file.id, messageId: args.result.message.id }
      : {}),
  };
}

export function registerUploadFileTool(server: McpServer, ctx: AppContext): void {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  server.registerTool(
    'rocketchat_upload_file',
    {
      title: `Upload a file to ${ctx.config.workspaceName}`,
      description:
        `Upload one local file to exactly one destination in the configured Rocket.Chat ` +
        `workspace ${workspace}. The path must pass ROCKETCHAT_ALLOWED_UPLOAD_PATHS, and the ` +
        `destination must pass the existing room/DM policy. E2EE rooms and new DMs without an ` +
        `existing room are rejected. THIS CREATES AN EXTERNAL SIDE EFFECT when dryRun=false. ` +
        `Always call rocketchat_preview_file first with the final file and destination, show its ` +
        `complete preview verbatim, then call this tool with identical file details and ` +
        `dryRun=false. dryRun=true remains available only for backward compatibility.`,
      inputSchema: INPUT_SHAPE,
      outputSchema: OUTPUT_SHAPE,
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      runTool(ctx, 'rocketchat_upload_file', async (log: Logger) => {
        const result = await ctx.uploadFileService.upload(args);
        log.info('file.audit', auditFields({ ...args, result }));
        return successTextResult(
          result,
          humanFileResult(ctx.config.workspaceName, result),
          ctx.redactor,
        );
      }),
  );
}
