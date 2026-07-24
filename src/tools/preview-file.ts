/**
 * `rocketchat_preview_file` — validate and render a local file upload without
 * creating any external side effect.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import { READ_ONLY_ANNOTATIONS } from '../server/tool-annotations.js';
import {
  FILE_DESTINATION_SHAPE,
  FILE_INPUT_SHAPE,
  FILE_RESULT_SHAPE,
  humanFileResult,
} from './upload-file.js';
import { runTool } from './run-tool.js';
import { successTextResult } from './result.js';

const OUTPUT_SHAPE = {
  uploaded: z.literal(false),
  preview: z.literal(true),
  destination: FILE_DESTINATION_SHAPE,
  file: FILE_RESULT_SHAPE,
  description: z.string().optional(),
  renderedMessage: z.string().optional(),
  previewText: z
    .string()
    .describe('Complete user-facing preview. Display this entire value verbatim before uploading.'),
};

export function registerPreviewFileTool(server: McpServer, ctx: AppContext): void {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  server.registerTool(
    'rocketchat_preview_file',
    {
      title: `Preview a file upload to ${ctx.config.workspaceName}`,
      description:
        `Required read-only step before uploading a local file to the configured Rocket.Chat ` +
        `workspace ${workspace}. Resolves the destination and validates the local path allowlist, ` +
        `file metadata, size, E2EE and optional thread without uploading anything. This tool has ` +
        `no external side effect and should not require human approval. Copy the ENTIRE ` +
        `previewText value verbatim before calling rocketchat_upload_file with the same file ` +
        `details and dryRun=false. If the user requested preview only, stop after this tool.`,
      inputSchema: FILE_INPUT_SHAPE,
      outputSchema: OUTPUT_SHAPE,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) =>
      runTool(ctx, 'rocketchat_preview_file', async () => {
        const result = await ctx.uploadFileService.upload({ ...args, dryRun: true });
        if (result.uploaded) {
          throw new Error('File preview unexpectedly created an uploaded result.');
        }
        const previewText = humanFileResult(ctx.config.workspaceName, result);
        return successTextResult({ ...result, previewText }, previewText, ctx.redactor);
      }),
  );
}
