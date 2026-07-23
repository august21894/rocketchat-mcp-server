/**
 * Composition root — build all services from a validated config.
 *
 * The context is injectable (fetch, logger, clock) so services can be exercised
 * end-to-end in tests against a local mock server.
 */
import type { AppConfig } from './config/schema.js';
import { createLogger, type Logger } from './observability/logger.js';
import { Redactor } from './observability/redaction.js';
import { RocketChatClient, type FetchLike } from './rocketchat/client.js';
import { ContentPolicy } from './policies/content-policy.js';
import { DestinationPolicy } from './policies/destination-policy.js';
import { MentionPolicy } from './policies/mention-policy.js';
import { ConnectionService } from './services/connection-service.js';
import { UserService } from './services/user-service.js';
import { RoomService } from './services/room-service.js';
import { TargetResolver } from './services/target-resolver.js';
import { IdempotencyService } from './services/idempotency-service.js';
import { MessageService } from './services/message-service.js';

export interface AppContext {
  config: AppConfig;
  logger: Logger;
  redactor: Redactor;
  client: RocketChatClient;
  connectionService: ConnectionService;
  userService: UserService;
  roomService: RoomService;
  targetResolver: TargetResolver;
  idempotencyService: IdempotencyService;
  messageService: MessageService;
  destinationPolicy: DestinationPolicy;
  mentionPolicy: MentionPolicy;
  contentPolicy: ContentPolicy;
}

export interface CreateContextOptions {
  /** Injectable fetch for tests/contract suites. */
  fetchFn?: FetchLike;
  /** Injectable clock (epoch ms). */
  now?: () => number;
  /** Provide a pre-built logger (otherwise one is created from config). */
  logger?: Logger;
}

export function createContext(config: AppConfig, options: CreateContextOptions = {}): AppContext {
  const redactor = new Redactor([config.authToken]);
  const logger = options.logger ?? createLogger({ level: config.logLevel, redactor });

  const client = new RocketChatClient({
    baseUrl: config.baseUrl,
    userId: config.userId,
    authToken: config.authToken,
    timeoutMs: config.requestTimeoutMs,
    logger,
    ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  const destinationPolicy = new DestinationPolicy(config);
  const mentionPolicy = new MentionPolicy(config);
  const contentPolicy = new ContentPolicy(config);

  const connectionService = new ConnectionService(client);
  const userService = new UserService(client);
  const roomService = new RoomService(client, destinationPolicy);
  const targetResolver = new TargetResolver(roomService, userService);
  const idempotencyService = new IdempotencyService(options.now ? { now: options.now } : {});

  const messageService = new MessageService({
    client,
    resolver: targetResolver,
    destinationPolicy,
    mentionPolicy,
    contentPolicy,
    idempotency: idempotencyService,
    logger,
    disableUrlPreview: config.disableUrlPreview,
  });

  return {
    config,
    logger,
    redactor,
    client,
    connectionService,
    userService,
    roomService,
    targetResolver,
    idempotencyService,
    messageService,
    destinationPolicy,
    mentionPolicy,
    contentPolicy,
  };
}
