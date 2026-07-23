/**
 * `rocketchat_search_users` — find users via users.autocomplete (no Mongo query).
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import { READ_ONLY_ANNOTATIONS } from '../server/tool-annotations.js';
import { runTool } from './run-tool.js';
import { successResult } from './result.js';

const INPUT_SHAPE = {
  query: z.string().min(1).max(100).describe('Username or display-name fragment to search for.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe('Maximum number of users to return (1-50).'),
};

const OUTPUT_SHAPE = {
  users: z.array(
    z.object({
      id: z.string(),
      username: z.string(),
      name: z.string().optional(),
      status: z.string().optional(),
    }),
  ),
};

export function registerSearchUsersTool(server: McpServer, ctx: AppContext): void {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  server.registerTool(
    'rocketchat_search_users',
    {
      title: `Search ${ctx.config.workspaceName} users`,
      description:
        `Search users in the configured Rocket.Chat workspace ${workspace} by username or ` +
        `display name. Use this to resolve a person mentioned in a request about ${workspace} ` +
        `before sending a DM or mentioning someone. Returns only safe fields ` +
        `(id, username, name, status).`,
      inputSchema: INPUT_SHAPE,
      outputSchema: OUTPUT_SHAPE,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, limit }) =>
      runTool(ctx, 'rocketchat_search_users', async () => {
        const users = await ctx.userService.searchUsers(query, limit);
        return successResult({ users }, ctx.redactor);
      }),
  );
}
