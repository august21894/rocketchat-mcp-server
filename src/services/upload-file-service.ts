/** Orchestrates safe local-file upload and Rocket.Chat media confirmation. */
import { AppError } from '../errors.js';
import type { ContentPolicy } from '../policies/content-policy.js';
import type { DestinationPolicy } from '../policies/destination-policy.js';
import type { FilePolicy } from '../policies/file-policy.js';
import type { MentionPolicy } from '../policies/mention-policy.js';
import { normalizeError } from '../rocketchat/errors.js';
import type { RocketChatClient } from '../rocketchat/client.js';
import type { RcMediaConfirmPayload } from '../rocketchat/types.js';
import type { DestinationSummary } from './message-service.js';
import { AI_MESSAGE_ICON } from './message-service.js';
import type { ResolvedDestination, Target, TargetResolver } from './target-resolver.js';

export interface UploadFileInput {
  target: Target;
  filePath: string;
  description?: string | null;
  message?: string | null;
  threadMessageId?: string | null;
  dryRun?: boolean;
}

export interface UploadFilePreviewResult {
  uploaded: false;
  preview: true;
  destination: DestinationSummary;
  file: UploadFileSummary;
  description?: string;
  renderedMessage?: string;
}

export interface UploadedFileResult {
  uploaded: true;
  preview: false;
  destination: DestinationSummary;
  file: UploadFileSummary & { id?: string; url?: string };
  message: { id: string; roomId: string; timestamp: string };
}

export interface UploadFileSummary {
  name: string;
  size: number;
  contentType: string;
}

export type UploadFileResult = UploadFilePreviewResult | UploadedFileResult;

export interface UploadFileServiceDeps {
  client: RocketChatClient;
  resolver: TargetResolver;
  destinationPolicy: DestinationPolicy;
  filePolicy: FilePolicy;
  contentPolicy: ContentPolicy;
  mentionPolicy: MentionPolicy;
}

export class UploadFileService {
  constructor(private readonly deps: UploadFileServiceDeps) {}

  async upload(input: UploadFileInput): Promise<UploadFileResult> {
    const destination = await this.deps.resolver.resolve(input.target);
    this.assertDestination(destination);

    if (!destination.roomId) {
      throw new AppError(
        'destination_not_found',
        'File upload requires an existing Rocket.Chat room or direct-message room.',
      );
    }

    const file = await this.deps.filePolicy.inspect(input.filePath);
    const description = this.normalizeOptional(input.description);
    const renderedMessage = this.renderOptionalMessage(input.message);

    if (input.threadMessageId) {
      await this.assertThreadBelongsToRoom(input.threadMessageId, destination.roomId);
    }

    const destinationSummary = summarizeDestination(destination);
    const fileSummary: UploadFileSummary = {
      name: file.name,
      size: file.size,
      contentType: file.contentType,
    };

    // Treat an omitted dryRun as a preview. Besides matching the public tool
    // default, this prevents a caller that bypasses schema defaulting from
    // accidentally creating an external side effect.
    if (input.dryRun !== false) {
      const result: UploadFilePreviewResult = {
        uploaded: false,
        preview: true,
        destination: destinationSummary,
        file: fileSummary,
      };
      if (description !== undefined) result.description = description;
      if (renderedMessage !== undefined) result.renderedMessage = renderedMessage;
      return result;
    }

    let serverVersion: string;
    try {
      serverVersion = (await this.deps.client.info()).version;
    } catch (error) {
      throw withStage(normalizeError(error), 'version_detection');
    }

    const bytes = await this.deps.filePolicy.read(file);
    if (usesLegacyUpload(serverVersion)) {
      try {
        const confirmed = await this.deps.client.roomsUpload({
          roomId: destination.roomId,
          bytes,
          fileName: file.name,
          contentType: file.contentType,
          ...(description !== undefined ? { description } : {}),
          ...(renderedMessage !== undefined ? { msg: renderedMessage } : {}),
          ...(input.threadMessageId ? { tmid: input.threadMessageId } : {}),
        });
        const legacyFileId = confirmed.file?._id;
        return {
          uploaded: true,
          preview: false,
          destination: destinationSummary,
          file: {
            ...fileSummary,
            ...(legacyFileId !== undefined ? { id: legacyFileId } : {}),
          },
          message: { id: confirmed._id, roomId: confirmed.rid, timestamp: confirmed.ts },
        };
      } catch (error) {
        throw normalizeWriteError(error, 'legacy_upload');
      }
    }

    let uploaded: { _id: string; url: string };
    try {
      uploaded = await this.deps.client.roomsMedia({
        roomId: destination.roomId,
        bytes,
        fileName: file.name,
        contentType: file.contentType,
      });
    } catch (error) {
      throw normalizeWriteError(error, 'media_upload');
    }

    try {
      const confirmPayload: RcMediaConfirmPayload = {};
      if (description !== undefined) confirmPayload.description = description;
      if (renderedMessage !== undefined) confirmPayload.msg = renderedMessage;
      if (input.threadMessageId) confirmPayload.tmid = input.threadMessageId;
      const confirmed = await this.deps.client.roomsMediaConfirm(
        destination.roomId,
        uploaded._id,
        confirmPayload,
      );

      return {
        uploaded: true,
        preview: false,
        destination: destinationSummary,
        file: { ...fileSummary, id: uploaded._id, url: uploaded.url },
        message: { id: confirmed._id, roomId: confirmed.rid, timestamp: confirmed.ts },
      };
    } catch (error) {
      throw normalizeWriteError(error, 'media_confirm');
    }
  }

  private assertDestination(destination: ResolvedDestination): void {
    if (destination.encrypted) {
      throw new AppError(
        'encrypted_room_not_supported',
        'The target room is end-to-end encrypted and file upload is not supported.',
        { details: { room: destination.name } },
      );
    }
    if (destination.type === 'direct') {
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

  private normalizeOptional(value: string | null | undefined): string | undefined {
    if (value == null) return undefined;
    return this.deps.contentPolicy.normalize(value);
  }

  private renderOptionalMessage(value: string | null | undefined): string | undefined {
    const normalized = this.normalizeOptional(value);
    if (normalized === undefined) return undefined;
    const withoutDuplicateIcon = normalized.replace(/^\s*🤖\uFE0F?\s*/u, '');
    const policyChecked = this.deps.mentionPolicy.render({
      text: withoutDuplicateIcon,
      mentions: [],
      groupMention: 'none',
    });
    return `${AI_MESSAGE_ICON} ${policyChecked}`;
  }

  private async assertThreadBelongsToRoom(threadMessageId: string, roomId: string): Promise<void> {
    const parent = await this.deps.client.chatGetMessage(threadMessageId);
    if (parent.rid !== roomId) {
      throw new AppError(
        'thread_room_mismatch',
        'The thread parent message does not belong to the target room.',
        { details: { threadMessageId } },
      );
    }
  }
}

function normalizeWriteError(
  error: unknown,
  stage: 'legacy_upload' | 'media_upload' | 'media_confirm',
): AppError {
  const appError = normalizeError(error);
  // A timeout/network/5xx on a write can mean Rocket.Chat processed the request
  // but the response was lost. Never invite the caller to retry the whole tool.
  if (
    appError.code === 'request_timeout' ||
    appError.code === 'network_error' ||
    appError.code === 'invalid_upstream_response' ||
    (appError.code === 'rocketchat_error' && appError.retryable)
  ) {
    const details: Record<string, unknown> = {
      ...(appError.details ?? {}),
      stage,
      causeCode: appError.code,
    };
    return new AppError(
      'unknown_delivery_state',
      `The Rocket.Chat file-upload state is unknown after ${stage}; do not retry automatically.`,
      { retryable: false, details, cause: error },
    );
  }
  return withStage(appError, stage);
}

function withStage(error: AppError, stage: string): AppError {
  return new AppError(error.code, error.message, {
    retryable: error.retryable,
    ...(error.retryAfterMs !== undefined ? { retryAfterMs: error.retryAfterMs } : {}),
    details: { ...(error.details ?? {}), stage },
    cause: error.cause,
  });
}

export function usesLegacyUpload(serverVersion: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(serverVersion.trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major < 6 || (major === 6 && minor < 10);
}

function summarizeDestination(destination: ResolvedDestination): DestinationSummary {
  const summary: DestinationSummary = {
    type: destination.type,
    name: destination.name,
  };
  if (destination.roomId !== undefined) summary.roomId = destination.roomId;
  if (destination.displayName !== undefined) summary.displayName = destination.displayName;
  if (destination.recipientUsername !== undefined) {
    summary.recipientUsername = destination.recipientUsername;
  }
  return summary;
}
