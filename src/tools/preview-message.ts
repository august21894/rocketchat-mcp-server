/**
 * `rocketchat_preview_message` — resolve and render the exact outbound message
 * without creating an external side effect.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import type { DestinationSummary, PreviewResult } from '../services/message-service.js';
import { READ_ONLY_ANNOTATIONS } from '../server/tool-annotations.js';
import { MESSAGE_INPUT_SHAPE } from './send-message.js';
import { runTool } from './run-tool.js';
import { successTextResult } from './result.js';

const OUTPUT_SHAPE = {
  sent: z.literal(false),
  preview: z.literal(true),
  destination: z.object({
    roomId: z.string().optional(),
    type: z.enum(['channel', 'private_room', 'direct']),
    name: z.string(),
    displayName: z.string().optional(),
    recipientUsername: z.string().optional(),
  }),
  renderedText: z.string(),
  previewText: z
    .string()
    .describe('Complete user-facing preview. Display this entire value verbatim before sending.'),
};

export const PREVIEW_TEXT_MAX_CHARS = 300;

function destinationLabel(destination: DestinationSummary): string {
  if (destination.type === 'direct') {
    const username = destination.recipientUsername ?? destination.name;
    const usernameLabel = username.startsWith('@') ? username : `@${username}`;
    if (destination.displayName) return `${destination.displayName} (${usernameLabel})`;
    return usernameLabel;
  }
  return destination.name.startsWith('#') ? destination.name : `#${destination.name}`;
}

function truncatePreviewText(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= PREVIEW_TEXT_MAX_CHARS) return text;
  return `${chars.slice(0, PREVIEW_TEXT_MAX_CHARS).join('').trimEnd()}...`;
}

function quoteMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function humanPreview(workspaceName: string, result: PreviewResult): string {
  return (
    `📨 **${workspaceName} → ${destinationLabel(result.destination)}**\n\n` +
    quoteMarkdown(truncatePreviewText(result.renderedText))
  );
}

export function registerPreviewMessageTool(server: McpServer, ctx: AppContext): void {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  server.registerTool(
    'rocketchat_preview_message',
    {
      title: `Preview a message to ${ctx.config.workspaceName}`,
      description:
        `Required read-only step before sending a message to the configured Rocket.Chat ` +
        `workspace ${workspace}. Resolve the final destination and render the exact outbound ` +
        `text, including the AI icon and mentions, without sending. Always call this after ` +
        `resolving the destination and before rocketchat_send_message. The previewText field is ` +
        `the complete user-facing preview: copy its ENTIRE value verbatim, including the first ` +
        `line "Facon → destination" and the message body. Never show only renderedText, summarize ` +
        `the preview, or replace the message with phrases such as "the original message". If the ` +
        `user requested preview only, stop after this tool and do not call rocketchat_send_message.`,
      inputSchema: MESSAGE_INPUT_SHAPE,
      outputSchema: OUTPUT_SHAPE,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) =>
      runTool(ctx, 'rocketchat_preview_message', async () => {
        const result = await ctx.messageService.send({
          target: args.target,
          text: args.text,
          format: args.format,
          codeLanguage: args.codeLanguage,
          mentions: args.mentions,
          groupMention: args.groupMention,
          threadMessageId: args.threadMessageId,
          idempotencyKey: null,
          dryRun: true,
        });
        if (result.sent) {
          throw new Error('Preview unexpectedly created a sent result.');
        }
        const previewText = humanPreview(ctx.config.workspaceName, result);
        return successTextResult({ ...result, previewText }, previewText, ctx.redactor);
      }),
  );
}
