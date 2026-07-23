#!/usr/bin/env node
/**
 * Entry point — load config, wire the context, and serve MCP over stdio.
 *
 * Application logs go to stderr only (the stdio transport owns stdout). On a
 * config error we print a sanitized message and exit non-zero. SIGINT/SIGTERM
 * and transport close trigger a clean shutdown.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, ConfigError } from './config/env.js';
import { resolveEnv } from './config/dotenv.js';
import { createContext } from './container.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server/create-server.js';

async function main(): Promise<void> {
  let config;
  try {
    // System environment wins; a .env file (cwd/.env or ROCKETCHAT_ENV_FILE)
    // only fills in keys that are not already set.
    config = loadConfig(resolveEnv());
  } catch (error) {
    if (error instanceof ConfigError) {
      // Sanitized message (never echoes values/secrets).
      process.stderr.write(error.message + '\n');
      process.exit(1);
    }
    throw error;
  }

  const ctx = createContext(config);
  const server = createServer(ctx);
  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.logger.info('server.shutdown', { reason });
    try {
      await server.close();
    } catch (error) {
      ctx.logger.error('server.shutdown_error', { error: String(error) });
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  transport.onclose = () => void shutdown('transport_closed');

  await server.connect(transport);
  ctx.logger.info('server.ready', {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    baseUrl: config.baseUrl,
    transport: config.transport,
  });
}

main().catch((error) => {
  process.stderr.write(`Fatal error during startup: ${String(error)}\n`);
  process.exit(1);
});
