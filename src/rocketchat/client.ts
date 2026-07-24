/**
 * Typed Rocket.Chat REST client.
 *
 * This is the ONLY place in the codebase allowed to perform HTTP. It centralizes
 * authentication headers, timeouts, error mapping, rate-limit parsing and the
 * (GET-only) retry policy so those concerns are applied uniformly.
 *
 * Retry policy (per the plan): only idempotent GET requests are retried, and
 * only on network errors or 5xx responses that occur before a write body could
 * have been acted upon. Write requests are NEVER retried automatically, because
 * a lost response leaves delivery state unknown.
 */
import type { Logger } from '../observability/logger.js';
import { ENDPOINTS, buildAutocompleteSelector } from './endpoints.js';
import { NetworkError, RequestTimeoutError, RocketChatHttpError } from './errors.js';
import { parseRateLimit, type RateLimitInfo } from './rate-limit.js';
import type {
  RcAutocompleteResponse,
  RcAutocompleteUser,
  RcMeResponse,
  RcMediaConfirmPayload,
  RcMediaUploadResponse,
  RcMessage,
  RcMessageResponse,
  RcPostMessagePayload,
  RcSendMessagePayload,
  RcSubscription,
  RcSubscriptionsResponse,
} from './types.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface RocketChatClientOptions {
  baseUrl: string;
  userId: string;
  authToken: string;
  timeoutMs: number;
  logger: Logger;
  /** Injectable fetch (defaults to global fetch) for contract tests. */
  fetchFn?: FetchLike;
  /** Injectable clock in epoch ms (defaults to Date.now). */
  now?: () => number;
  /** Max retries for GET requests on transient failures. Default 2. */
  maxGetRetries?: number;
  /** Base backoff between GET retries in ms. Default 200. */
  retryBackoffMs?: number;
}

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  formData?: FormData;
}

export class RocketChatClient {
  readonly baseUrl: string;
  private readonly userId: string;
  private readonly authToken: string;
  private readonly timeoutMs: number;
  private readonly logger: Logger;
  private readonly fetchFn: FetchLike;
  private readonly now: () => number;
  private readonly maxGetRetries: number;
  private readonly retryBackoffMs: number;

  constructor(options: RocketChatClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.userId = options.userId;
    this.authToken = options.authToken;
    this.timeoutMs = options.timeoutMs;
    this.logger = options.logger;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => Date.now());
    this.maxGetRetries = options.maxGetRetries ?? 2;
    this.retryBackoffMs = options.retryBackoffMs ?? 200;
  }

  // --- Public typed endpoints -------------------------------------------------

  /** `GET /api/v1/me` — authenticated identity. */
  async me(): Promise<RcMeResponse> {
    return this.request<RcMeResponse>({ method: 'GET', path: ENDPOINTS.me });
  }

  /** `GET /api/v1/users.autocomplete` — search users by term (no Mongo query). */
  async usersAutocomplete(term: string): Promise<RcAutocompleteUser[]> {
    const res = await this.request<RcAutocompleteResponse>({
      method: 'GET',
      path: ENDPOINTS.usersAutocomplete,
      query: { selector: buildAutocompleteSelector(term) },
    });
    return res.items ?? [];
  }

  /** `GET /api/v1/subscriptions.get` — the bot's room subscriptions. */
  async subscriptionsGet(): Promise<RcSubscription[]> {
    const res = await this.request<RcSubscriptionsResponse>({
      method: 'GET',
      path: ENDPOINTS.subscriptionsGet,
    });
    return res.update ?? [];
  }

  /** `POST /api/v1/chat.postMessage` — send by channel name/username or roomId. */
  async chatPostMessage(payload: RcPostMessagePayload): Promise<RcMessage> {
    const res = await this.request<RcMessageResponse>({
      method: 'POST',
      path: ENDPOINTS.chatPostMessage,
      body: payload,
    });
    return res.message;
  }

  /** `POST /api/v1/chat.sendMessage` — send by roomId with an optional stable _id. */
  async chatSendMessage(payload: RcSendMessagePayload): Promise<RcMessage> {
    const res = await this.request<RcMessageResponse>({
      method: 'POST',
      path: ENDPOINTS.chatSendMessage,
      body: payload,
    });
    return res.message;
  }

  /** `GET /api/v1/chat.getMessage` — fetch a single message by id. */
  async chatGetMessage(msgId: string): Promise<RcMessage> {
    const res = await this.request<RcMessageResponse>({
      method: 'GET',
      path: ENDPOINTS.chatGetMessage,
      query: { msgId },
    });
    return res.message;
  }

  /** `POST /api/v1/rooms.media/:rid` — upload bytes without sending them yet. */
  async roomsMedia(args: {
    roomId: string;
    bytes: Uint8Array;
    fileName: string;
    contentType: string;
  }): Promise<RcMediaUploadResponse['file']> {
    const formData = new FormData();
    // Copy into an ArrayBuffer-backed view accepted by Blob on every supported
    // Node version, including when the source is a pooled Buffer.
    const bytes = new Uint8Array(args.bytes.byteLength);
    bytes.set(args.bytes);
    formData.append('file', new Blob([bytes], { type: args.contentType }), args.fileName);
    const res = await this.request<RcMediaUploadResponse>({
      method: 'POST',
      path: ENDPOINTS.roomsMedia(args.roomId),
      formData,
    });
    return res.file;
  }

  /** `POST /api/v1/rooms.mediaConfirm/:rid/:fileId` — publish an uploaded file. */
  async roomsMediaConfirm(
    roomId: string,
    fileId: string,
    payload: RcMediaConfirmPayload,
  ): Promise<RcMessage> {
    const res = await this.request<RcMessageResponse>({
      method: 'POST',
      path: ENDPOINTS.roomsMediaConfirm(roomId, fileId),
      body: payload,
    });
    return res.message;
  }

  // --- Core request pipeline --------------------------------------------------

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const isGet = options.method === 'GET';
    const maxAttempts = isGet ? this.maxGetRetries + 1 : 1;
    let attempt = 0;
    while (true) {
      attempt += 1;
      try {
        return await this.executeOnce<T>(options, attempt);
      } catch (error) {
        const canRetry = isGet && attempt < maxAttempts && isTransient(error);
        if (!canRetry) {
          throw error;
        }
        const delay = this.retryBackoffMs * attempt;
        this.logger.warn('rocketchat.request.retry', {
          path: options.path,
          method: options.method,
          attempt,
          delayMs: delay,
        });
        await sleep(delay);
      }
    }
  }

  private async executeOnce<T>(options: RequestOptions, attempt: number): Promise<T> {
    const url = this.buildUrl(options.path, options.query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = this.now();

    const headers: Record<string, string> = {
      'X-User-Id': this.userId,
      'X-Auth-Token': this.authToken,
      Accept: 'application/json',
    };
    const init: RequestInit = {
      method: options.method,
      headers,
      signal: controller.signal,
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    } else if (options.formData !== undefined) {
      // Fetch supplies the multipart boundary. Setting Content-Type manually
      // would omit that boundary and make Rocket.Chat reject the upload.
      init.body = options.formData;
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, init);
    } catch (error) {
      if (isAbortError(error)) {
        throw new RequestTimeoutError(this.timeoutMs);
      }
      throw new NetworkError('Network request failed', { cause: error });
    } finally {
      clearTimeout(timer);
    }

    const rateLimit = parseRateLimit(response.headers, this.now());
    const durationMs = this.now() - startedAt;

    this.logger.debug('rocketchat.request', {
      method: options.method,
      path: options.path,
      status: response.status,
      durationMs,
      attempt,
      rateLimitRemaining: rateLimit.remaining,
      rateLimitResetAtMs: rateLimit.resetAtMs,
    });

    const bodyText = await safeReadText(response);
    const parsed = safeParseJson(bodyText);

    if (!response.ok) {
      throw new RocketChatHttpError({
        status: response.status,
        ...extractUpstreamError(parsed),
        rateLimit,
      });
    }

    // A 2xx with `success: false` is still a logical error in Rocket.Chat.
    if (parsed && typeof parsed === 'object' && 'success' in parsed && parsed.success === false) {
      throw new RocketChatHttpError({
        status: response.status,
        ...extractUpstreamError(parsed),
        rateLimit,
      });
    }

    return parsed as T;
  }
}

// --- helpers ------------------------------------------------------------------

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  );
}

/** GET requests retry on timeouts, network errors and 5xx responses. */
function isTransient(error: unknown): boolean {
  if (error instanceof RequestTimeoutError || error instanceof NetworkError) {
    return true;
  }
  if (error instanceof RocketChatHttpError) {
    return error.status >= 500;
  }
  return false;
}

function extractUpstreamError(parsed: unknown): { upstreamError?: string; errorType?: string } {
  if (!parsed || typeof parsed !== 'object') return {};
  const obj = parsed as Record<string, unknown>;
  const result: { upstreamError?: string; errorType?: string } = {};
  // Rocket.Chat uses `error` (+ `errorType`) on newer endpoints and `message`
  // on some older ones.
  const message = obj.error ?? obj.message;
  if (typeof message === 'string') result.upstreamError = message;
  if (typeof obj.errorType === 'string') result.errorType = obj.errorType;
  return result;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function safeParseJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type { RateLimitInfo };
