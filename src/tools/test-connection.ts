/**
 * `rocketchat_test_connection` — verify URL/credentials and return a safe identity.
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppContext } from '../container.js';
import { READ_ONLY_ANNOTATIONS } from '../server/tool-annotations.js';
import { runTool } from './run-tool.js';
import { successResult } from './result.js';

const OUTPUT_SHAPE = {
  connected: z.boolean(),
  baseUrl: z.string(),
  user: z.object({
    id: z.string(),
    username: z.string(),
  }),
};

export function registerTestConnectionTool(server: McpServer, ctx: AppContext): void {
  const workspace = JSON.stringify(ctx.config.workspaceName);
  server.registerTool(
    'rocketchat_test_connection',
    {
      title: `Test ${ctx.config.workspaceName} connection`,
      description:
        `Verify the connection to the configured Rocket.Chat workspace ${workspace} by ` +
        `calling a read-only endpoint. Use this when the user asks whether ${workspace} ` +
        `is connected or available. Returns the authenticated bot identity (id, username) ` +
        `only. Never returns tokens, sessions or unnecessary user data.`,
      inputSchema: {},
      outputSchema: OUTPUT_SHAPE,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () =>
      runTool(ctx, 'rocketchat_test_connection', async () => {
        const result = await ctx.connectionService.testConnection();
        return successResult(result, ctx.redactor);
      }),
  );
}
