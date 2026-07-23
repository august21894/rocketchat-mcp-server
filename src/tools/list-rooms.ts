/**
 * `rocketchat_list_rooms` — list rooms the bot has joined, filtered by policy.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import { READ_ONLY_ANNOTATIONS } from '../server/tool-annotations.js';
import { runTool } from './run-tool.js';
import { successResult } from './result.js';

const ROOM_TYPE = z.enum(['channel', 'private_room', 'direct']);

const INPUT_SHAPE = {
  types: z.array(ROOM_TYPE).optional().describe('Optional filter by normalized room type(s).'),
  query: z.string().max(100).optional().describe('Optional case-insensitive name filter.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe('Maximum number of rooms to return (1-100).'),
};

const OUTPUT_SHAPE = {
  rooms: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      displayName: z.string().optional(),
      type: ROOM_TYPE,
      encrypted: z.boolean(),
      recipientUsername: z.string().optional(),
    }),
  ),
};

export function registerListRoomsTool(server: McpServer, ctx: AppContext): void {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  server.registerTool(
    'rocketchat_list_rooms',
    {
      title: `List ${ctx.config.workspaceName} rooms`,
      description:
        `List rooms the bot has joined in the configured Rocket.Chat workspace ${workspace}. ` +
        `Use this to resolve a channel, private room or DM destination mentioned in a request ` +
        `about ${workspace}. Room types are normalized (c→channel, p→private_room, d→direct). ` +
        `Only rooms the destination policy allows the agent to see are returned.`,
      inputSchema: INPUT_SHAPE,
      outputSchema: OUTPUT_SHAPE,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ types, query, limit }) =>
      runTool(ctx, 'rocketchat_list_rooms', async () => {
        const rooms = await ctx.roomService.listRooms({
          limit,
          ...(types ? { types } : {}),
          ...(query ? { query } : {}),
        });
        return successResult({ rooms }, ctx.redactor);
      }),
  );
}
