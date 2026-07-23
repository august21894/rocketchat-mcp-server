/**
 * Message service — orchestrates the full send workflow:
 * resolve → E2EE guard → destination policy → content/mention policy →
 * thread validation → dry-run render → idempotent delivery.
 *
 * Never leaks raw upstream payloads; returns normalized output only.
 */
import { AppError } from '../errors.js';
import { normalizeError } from '../rocketchat/errors.js';
import type { RocketChatClient } from '../rocketchat/client.js';
import type {
  NormalizedRoomType,
  RcPostMessagePayload,
  RcSendMessagePayload,
} from '../rocketchat/types.js';
import type { Logger } from '../observability/logger.js';
import type { ContentPolicy } from '../policies/content-policy.js';
import type { DestinationPolicy } from '../policies/destination-policy.js';
import type { GroupMention, MentionPolicy } from '../policies/mention-policy.js';
import type { IdempotencyService } from './idempotency-service.js';
import type { ResolvedDestination, Target, TargetResolver } from './target-resolver.js';

export const AI_MESSAGE_ICON = '🤖';
export type MessageFormat = 'plain' | 'code_block';

function stripLeadingAiIcon(text: string): string {
  return text.replace(/^\s*🤖\uFE0F?\s*/u, '');
}

function addAiIcon(text: string): string {
  return text.length === 0 ? AI_MESSAGE_ICON : `${AI_MESSAGE_ICON} ${text}`;
}

function codeFenceFor(text: string): string {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  return '`'.repeat(Math.max(3, longestRun + 1));
}

function renderCodeBlock(text: string, language: string | null, mentionPrefix: string): string {
  const fence = codeFenceFor(text);
  const header = language ? `${fence}${language}` : fence;
  const senderLine = mentionPrefix ? `${AI_MESSAGE_ICON} ${mentionPrefix}` : AI_MESSAGE_ICON;
  return `${senderLine}\n\n${header}\n${text}\n${fence}`;
}

export interface SendMessageInput {
  target: Target;
  text: string;
  format?: MessageFormat;
  codeLanguage?: string | null;
  mentions: string[];
  groupMention: GroupMention;
  threadMessageId: string | null;
  idempotencyKey: string | null;
  dryRun: boolean;
}

export interface DestinationSummary {
  roomId?: string;
  type: NormalizedRoomType;
  name: string;
  displayName?: string;
  recipientUsername?: string;
}

export interface PreviewResult {
  sent: false;
  preview: true;
  destination: DestinationSummary;
  renderedText: string;
}

export interface SentResult {
  sent: true;
  duplicate: boolean;
  destination: DestinationSummary;
  message: {
    id: string;
    roomId: string;
    timestamp: string;
  };
}

export type SendMessageResult = PreviewResult | SentResult;

interface DeliveryOutput {
  id: string;
  roomId: string;
  timestamp: string;
  duplicate: boolean;
}

export interface MessageServiceDeps {
  client: RocketChatClient;
  resolver: TargetResolver;
  destinationPolicy: DestinationPolicy;
  mentionPolicy: MentionPolicy;
  contentPolicy: ContentPolicy;
  idempotency: IdempotencyService;
  logger: Logger;
  disableUrlPreview: boolean;
}

export class MessageService {
  constructor(private readonly deps: MessageServiceDeps) {}

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const destination = await this.deps.resolver.resolve(input.target);

    // 1. E2EE guard — never downgrade to plaintext implicitly.
    if (destination.encrypted) {
      throw new AppError(
        'encrypted_room_not_supported',
        'The target room is end-to-end encrypted and is not supported.',
        { retryable: false, details: { room: destination.name } },
      );
    }

    // 2. Destination policy (deny-by-default).
    this.assertDestinationAllowed(destination);

    // 3. Content + mention rendering.
    const cleanText = this.deps.contentPolicy.normalize(input.text);
    const messageText = stripLeadingAiIcon(cleanText);
    let renderedText: string;
    if (input.format === 'code_block') {
      // Validate embedded mention tokens separately so mentions stay outside the
      // fenced block and still notify their recipients.
      this.deps.mentionPolicy.render({
        text: messageText,
        mentions: [],
        groupMention: 'none',
      });
      const mentionPrefix = this.deps.mentionPolicy
        .render({
          text: '',
          mentions: input.mentions,
          groupMention: input.groupMention,
        })
        .trim();
      renderedText = renderCodeBlock(messageText, input.codeLanguage ?? null, mentionPrefix);
    } else {
      const textWithMentions = this.deps.mentionPolicy.render({
        text: messageText,
        mentions: input.mentions,
        groupMention: input.groupMention,
      });
      renderedText = addAiIcon(textWithMentions);
    }

    // 4. Thread validation — the parent must live in the resolved room.
    if (input.threadMessageId) {
      await this.assertThreadBelongsToRoom(input.threadMessageId, destination);
    }

    const summary: DestinationSummary = { type: destination.type, name: destination.name };
    if (destination.roomId !== undefined) summary.roomId = destination.roomId;
    if (destination.displayName !== undefined) summary.displayName = destination.displayName;
    if (destination.recipientUsername !== undefined) {
      summary.recipientUsername = destination.recipientUsername;
    }

    // 5. Dry-run preview (no side effect).
    if (input.dryRun) {
      return { sent: false, preview: true, destination: summary, renderedText };
    }

    // 6. Idempotent delivery.
    return this.deliverIdempotent(input, destination, renderedText, summary);
  }

  private assertDestinationAllowed(destination: ResolvedDestination): void {
    if (destination.type === 'direct') {
      // recipientUsername is always set for a direct destination.
      this.deps.destinationPolicy.assertDmAllowed(
        destination.recipientUsername ?? destination.name,
      );
      return;
    }
    this.deps.destinationPolicy.assertRoomAllowed({
      id: destination.roomId ?? '',
      name: destination.name,
    });
  }

  private async assertThreadBelongsToRoom(
    threadMessageId: string,
    destination: ResolvedDestination,
  ): Promise<void> {
    if (!destination.roomId) {
      throw new AppError(
        'thread_room_mismatch',
        'Thread replies require a resolvable room; the destination has no room id yet.',
        { retryable: false },
      );
    }
    const parent = await this.deps.client.chatGetMessage(threadMessageId);
    if (parent.rid !== destination.roomId) {
      throw new AppError(
        'thread_room_mismatch',
        'The thread parent message does not belong to the target room.',
        { retryable: false, details: { threadMessageId } },
      );
    }
  }

  private async deliverIdempotent(
    input: SendMessageInput,
    destination: ResolvedDestination,
    renderedText: string,
    summary: DestinationSummary,
  ): Promise<SentResult> {
    const key = input.idempotencyKey;

    if (key) {
      const existing = this.deps.idempotency.get(key);
      if (existing?.state === 'succeeded' && existing.result) {
        return {
          sent: true,
          duplicate: true,
          destination: summary,
          message: {
            id: existing.result.messageId,
            roomId: existing.result.roomId,
            timestamp: existing.result.timestamp,
          },
        };
      }
      if (existing?.state === 'pending') {
        throw new AppError(
          'duplicate_request',
          'A send with this idempotency key is already in progress.',
          { retryable: false },
        );
      }
      this.deps.idempotency.markPending(key);
    }

    try {
      const delivered = await this.deliver(input, destination, renderedText, key);
      if (key) {
        this.deps.idempotency.markSucceeded(key, {
          messageId: delivered.id,
          roomId: delivered.roomId,
          timestamp: delivered.timestamp,
        });
      }
      return {
        sent: true,
        duplicate: delivered.duplicate,
        destination: summary,
        message: { id: delivered.id, roomId: delivered.roomId, timestamp: delivered.timestamp },
      };
    } catch (error) {
      if (key) this.deps.idempotency.markFailed(key);
      throw normalizeError(error);
    }
  }

  private async deliver(
    input: SendMessageInput,
    destination: ResolvedDestination,
    renderedText: string,
    key: string | null,
  ): Promise<DeliveryOutput> {
    const parseUrls = this.deps.disableUrlPreview ? false : undefined;

    // Prefer chat.sendMessage when we have a room id: it supports a stable _id
    // (idempotency) and thread replies via tmid.
    if (destination.roomId) {
      const message: RcSendMessagePayload['message'] = {
        rid: destination.roomId,
        msg: renderedText,
      };
      if (parseUrls !== undefined) message.parseUrls = parseUrls;
      if (input.threadMessageId) message.tmid = input.threadMessageId;
      const derivedId = key ? this.deps.idempotency.deriveMessageId(key) : undefined;
      if (derivedId) message._id = derivedId;

      try {
        const sent = await this.deps.client.chatSendMessage({ message });
        return { id: sent._id, roomId: sent.rid, timestamp: sent.ts, duplicate: false };
      } catch (error) {
        const app = normalizeError(error);
        // A duplicate _id means this exact message was already delivered.
        if (derivedId && isDuplicateMessageError(app)) {
          this.deps.logger.info('message.duplicate_detected', { via: 'sendMessage' });
          const existing = await this.deps.client.chatGetMessage(derivedId);
          return {
            id: existing._id,
            roomId: existing.rid,
            timestamp: existing.ts,
            duplicate: true,
          };
        }
        throw app;
      }
    }

    // No room id yet (new DM): chat.postMessage creates the DM. This path can't
    // use a stable _id, so cross-restart dedup is best-effort only.
    const payload: RcPostMessagePayload = {
      channel: `@${destination.recipientUsername ?? destination.name}`,
      text: renderedText,
    };
    if (parseUrls !== undefined) payload.parseUrls = parseUrls;
    const sent = await this.deps.client.chatPostMessage(payload);
    return { id: sent._id, roomId: sent.rid, timestamp: sent.ts, duplicate: false };
  }
}

/** Heuristic: does this mapped error indicate a duplicate message id? */
function isDuplicateMessageError(error: AppError): boolean {
  const errorType = typeof error.details?.errorType === 'string' ? error.details.errorType : '';
  const upstream = typeof error.details?.upstream === 'string' ? error.details.upstream : '';
  return /duplicate/i.test(errorType) || /duplicate|already exists/i.test(upstream);
}
