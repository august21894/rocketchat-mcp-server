/**
 * `rocketchat_send_message` — send one message to exactly one destination.
 *
 * Side-effecting tool. `dryRun` defaults to `true`; a clear user request to
 * send is sufficient approval for an MCP client to invoke with `dryRun=false`.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import type { Logger } from '../observability/logger.js';
import { SEND_MESSAGE_ANNOTATIONS } from '../server/tool-annotations.js';
import { runTool } from './run-tool.js';
import { successResult, successTextResult } from './result.js';
import type {
  DestinationSummary,
  SendMessageResult,
  SentResult,
} from '../services/message-service.js';

const TARGET_TYPE = z.enum(['channel', 'private_room', 'user', 'room_id']);

export const MESSAGE_INPUT_SHAPE = {
  target: z
    .object({
      type: TARGET_TYPE.describe(
        'channel = public channel name, private_room = private room name/id, ' +
          'user = username (DM), room_id = known room id.',
      ),
      value: z.string().min(1).max(200),
    })
    .describe('Exactly one destination. Wildcards and arrays are not supported.'),
  text: z
    .string()
    .min(1)
    .describe('Required message body. Attachment-only messages are not supported.'),
  format: z
    .enum(['plain', 'code_block'])
    .default('plain')
    .describe(
      'Message rendering format. Use code_block when the user asks to send code, a code block, or fenced code.',
    ),
  codeLanguage: z
    .string()
    .regex(/^[0-9A-Za-z_+.#-]{1,30}$/)
    .nullable()
    .default(null)
    .describe(
      'Optional fenced-code language such as typescript, java, json, or bash. Used only with format=code_block.',
    ),
  mentions: z
    .array(z.string().min(1).max(100))
    .default([])
    .describe('Usernames to mention (resolve them with rocketchat_search_users first).'),
  groupMention: z
    .enum(['none', 'here', 'all'])
    .default('none')
    .describe('Group mention. "here"/"all" require the corresponding feature flag.'),
  threadMessageId: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe('Parent message id for a thread reply; must belong to the resolved room.'),
};

const INPUT_SHAPE = {
  ...MESSAGE_INPUT_SHAPE,
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .default(null)
    .describe('Caller-supplied key to prevent duplicate delivery on retry.'),
  dryRun: z
    .boolean()
    .default(true)
    .describe('When true (default), render and validate without sending.'),
};

const OUTPUT_SHAPE = {
  sent: z.boolean(),
  preview: z.boolean().optional(),
  duplicate: z.boolean().optional(),
  destination: z
    .object({
      roomId: z.string().optional(),
      type: z.enum(['channel', 'private_room', 'direct']),
      name: z.string(),
      displayName: z.string().optional(),
      recipientUsername: z.string().optional(),
    })
    .optional(),
  renderedText: z.string().optional(),
  message: z
    .object({
      id: z.string(),
      roomId: z.string(),
      timestamp: z.string(),
    })
    .optional(),
};

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

function auditFields(input: {
  target: { type: string; value: string };
  idempotencyKey: string | null;
  dryRun: boolean;
  result: SendMessageResult;
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    targetType: input.target.type,
    dryRun: input.dryRun,
  };
  if (input.idempotencyKey) fields.idempotencyKeyHash = hashKey(input.idempotencyKey);
  if (input.result.sent) {
    fields.sent = true;
    fields.duplicate = input.result.duplicate;
    fields.messageId = input.result.message.id;
    fields.roomId = input.result.message.roomId;
  } else {
    fields.sent = false;
    fields.preview = true;
    if (input.result.destination.roomId) fields.roomId = input.result.destination.roomId;
  }
  return fields;
}

function destinationLabel(destination: DestinationSummary): string {
  if (destination.type === 'direct') {
    const username = destination.recipientUsername ?? destination.name;
    const usernameLabel = username.startsWith('@') ? username : `@${username}`;
    if (destination.displayName) return `${destination.displayName} (${usernameLabel})`;
    return usernameLabel;
  }
  return destination.name.startsWith('#') ? destination.name : `#${destination.name}`;
}

function humanSendResult(result: SentResult): string {
  const destination = destinationLabel(result.destination);
  if (result.duplicate) return `✅ Tin nhắn Facon cho ${destination} đã được gửi trước đó.`;
  return `✅ Đã gửi tin nhắn Facon cho ${destination}.`;
}

export function registerSendMessageTool(server: McpServer, ctx: AppContext): void {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  server.registerTool(
    'rocketchat_send_message',
    {
      title: `Send a message to ${ctx.config.workspaceName}`,
      description:
        `Send a single message to exactly one destination in the configured Rocket.Chat ` +
        `workspace ${workspace}. Use this whenever the user asks to send, message, notify or ` +
        `post something to ${workspace} or to the configured Rocket.Chat workspace. Supports ` +
        `channels, private rooms, DMs, room ids, optional user mentions, gated @here/@all and ` +
        `thread replies. THIS CREATES AN EXTERNAL SIDE EFFECT when dryRun=false. Before sending, ` +
        `rocketchat_preview_message must be called with the final message details and its ` +
        `human-readable text result must be shown verbatim to the user. Then call this tool with ` +
        `the same message details and dryRun=false. On success, show this tool's human-readable ` +
        `result verbatim; for DMs it prefers the resolved display name over the username. Use ` +
        `dryRun=true only for backward-compatible ` +
        `programmatic previews. Does not accept alias, avatar, attachments or custom REST payloads.`,
      inputSchema: INPUT_SHAPE,
      outputSchema: OUTPUT_SHAPE,
      annotations: SEND_MESSAGE_ANNOTATIONS,
    },
    async (args) =>
      runTool(ctx, 'rocketchat_send_message', async (log: Logger) => {
        const result = await ctx.messageService.send({
          target: args.target,
          text: args.text,
          format: args.format,
          codeLanguage: args.codeLanguage,
          mentions: args.mentions,
          groupMention: args.groupMention,
          threadMessageId: args.threadMessageId,
          idempotencyKey: args.idempotencyKey,
          dryRun: args.dryRun,
        });
        log.info('message.audit', auditFields({ ...args, result }));
        if (result.sent) {
          return successTextResult(result, humanSendResult(result), ctx.redactor);
        }
        return successResult(result, ctx.redactor);
      }),
  );
}
