/**
 * A small in-process HTTP server that implements the subset of the Rocket.Chat
 * REST API this project uses. Reused by contract, integration and e2e tests so
 * the whole stack can run without an external workspace.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockUser {
  _id: string;
  username: string;
  name?: string;
  status?: string;
}

export interface MockSubscription {
  _id: string;
  rid: string;
  name: string;
  fname?: string;
  t: 'c' | 'p' | 'd';
  encrypted?: boolean;
}

export interface MockMessage {
  _id: string;
  rid: string;
  msg: string;
  ts: string;
  tmid?: string;
  u: { _id: string; username: string };
  file?: { _id: string; name: string; type: string; size: number };
}

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** A one-shot response override, consumed FIFO on the next matching request. */
export interface ResponseOverride {
  /** Only apply to requests whose path includes this substring (any if omitted). */
  pathIncludes?: string;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface MockOptions {
  userId: string;
  authToken: string;
  botUserId?: string;
  botUsername?: string;
  users?: MockUser[];
  subscriptions?: MockSubscription[];
  serverVersion?: string;
}

export class MockRocketChat {
  readonly requests: RecordedRequest[] = [];
  private server: Server | undefined;
  private baseUrlValue = '';
  private readonly overrides: ResponseOverride[] = [];
  private delayMs = 0;
  private msgCounter = 0;
  private fileCounter = 0;
  private readonly uploadedFiles = new Map<string, { roomId: string; name: string }>();
  serverVersion: string;

  users: MockUser[];
  subscriptions: MockSubscription[];
  readonly messages = new Map<string, MockMessage>();

  constructor(private readonly options: MockOptions) {
    this.users = [...(options.users ?? [])];
    this.subscriptions = [...(options.subscriptions ?? [])];
    this.serverVersion = options.serverVersion ?? '7.0.0';
  }

  get baseUrl(): string {
    return this.baseUrlValue;
  }

  get botUserId(): string {
    return this.options.botUserId ?? this.options.userId;
  }

  get botUsername(): string {
    return this.options.botUsername ?? 'coding-agent';
  }

  /** Force the next (optionally path-matched) request to return this response. */
  enqueueOverride(override: ResponseOverride): void {
    this.overrides.push(override);
  }

  /** Add an artificial delay to every response (to exercise client timeouts). */
  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  reset(): void {
    this.requests.length = 0;
    this.overrides.length = 0;
    this.delayMs = 0;
    this.uploadedFiles.clear();
    this.serverVersion = this.options.serverVersion ?? '7.0.0';
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve) => {
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = this.server.address() as AddressInfo;
    this.baseUrlValue = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err) => (err ? reject(err) : resolve()));
    });
    this.server = undefined;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const body = await readBody(req);

    this.requests.push({
      method: req.method ?? 'GET',
      path: url.pathname,
      query,
      headers: req.headers,
      body,
    });

    if (this.delayMs > 0) {
      await new Promise((r) => setTimeout(r, this.delayMs));
    }

    // Consume a queued override if it matches.
    const overrideIdx = this.overrides.findIndex(
      (o) => !o.pathIncludes || url.pathname.includes(o.pathIncludes),
    );
    if (overrideIdx >= 0) {
      const [override] = this.overrides.splice(overrideIdx, 1);
      this.send(res, override!.status, override!.body ?? {}, override!.headers);
      return;
    }

    // Authentication.
    const userId = req.headers['x-user-id'];
    const token = req.headers['x-auth-token'];
    if (userId !== this.options.userId || token !== this.options.authToken) {
      this.send(res, 401, {
        success: false,
        error: 'Unauthorized',
        errorType: 'error-unauthorized',
      });
      return;
    }

    this.route(url.pathname, req.method ?? 'GET', query, body, res);
  }

  private route(
    path: string,
    method: string,
    query: Record<string, string>,
    body: unknown,
    res: ServerResponse,
  ): void {
    if (path === '/api/info' && method === 'GET') {
      this.send(res, 200, { success: true, version: this.serverVersion });
      return;
    }

    if (path === '/api/v1/me' && method === 'GET') {
      this.send(res, 200, {
        success: true,
        _id: this.botUserId,
        username: this.botUsername,
        name: 'Coding Agent',
        status: 'online',
      });
      return;
    }

    if (path === '/api/v1/users.autocomplete' && method === 'GET') {
      const term = parseTerm(query.selector);
      const items = this.users.filter(
        (u) =>
          u.username.toLowerCase().includes(term) || (u.name ?? '').toLowerCase().includes(term),
      );
      this.send(res, 200, { success: true, items });
      return;
    }

    if (path === '/api/v1/subscriptions.get' && method === 'GET') {
      this.send(res, 200, { success: true, update: this.subscriptions, remove: [] });
      return;
    }

    if (path === '/api/v1/chat.getMessage' && method === 'GET') {
      const msg = this.messages.get(query.msgId ?? '');
      if (!msg) {
        this.send(res, 400, {
          success: false,
          error: 'Message not found',
          errorType: 'error-invalid-message',
        });
        return;
      }
      this.send(res, 200, { success: true, message: msg });
      return;
    }

    if (path === '/api/v1/chat.postMessage' && method === 'POST') {
      this.handlePostMessage(body, res);
      return;
    }

    if (path === '/api/v1/chat.sendMessage' && method === 'POST') {
      this.handleSendMessage(body, res);
      return;
    }

    const mediaMatch = path.match(/^\/api\/v1\/rooms\.media\/([^/]+)$/);
    if (mediaMatch && method === 'POST') {
      this.handleMediaUpload(decodeURIComponent(mediaMatch[1]!), body, res);
      return;
    }

    const uploadMatch = path.match(/^\/api\/v1\/rooms\.upload\/([^/]+)$/);
    if (uploadMatch && method === 'POST') {
      this.handleLegacyUpload(decodeURIComponent(uploadMatch[1]!), body, res);
      return;
    }

    const confirmMatch = path.match(/^\/api\/v1\/rooms\.mediaConfirm\/([^/]+)\/([^/]+)$/);
    if (confirmMatch && method === 'POST') {
      this.handleMediaConfirm(
        decodeURIComponent(confirmMatch[1]!),
        decodeURIComponent(confirmMatch[2]!),
        body,
        res,
      );
      return;
    }

    this.send(res, 404, { success: false, error: 'Not found', errorType: 'error-not-found' });
  }

  private resolveRoomId(channel: string | undefined, roomId: string | undefined): string {
    if (roomId) return roomId;
    if (channel && channel.startsWith('@')) {
      // DM: synthesize a stable room id from the username.
      return `dm-${channel.slice(1)}`;
    }
    if (channel && channel.startsWith('#')) {
      const name = channel.slice(1);
      const sub = this.subscriptions.find((s) => s.name === name);
      return sub?.rid ?? `room-${name}`;
    }
    return `room-${channel ?? 'unknown'}`;
  }

  private handlePostMessage(body: unknown, res: ServerResponse): void {
    const b = (body ?? {}) as { channel?: string; roomId?: string; text?: string };
    const rid = this.resolveRoomId(b.channel, b.roomId);
    const message = this.createMessage(rid, b.text ?? '');
    this.send(res, 200, { success: true, message });
  }

  private handleSendMessage(body: unknown, res: ServerResponse): void {
    const b = (body ?? {}) as {
      message?: { _id?: string; rid?: string; msg?: string; tmid?: string };
    };
    const msg = b.message ?? {};
    if (msg._id && this.messages.has(msg._id)) {
      this.send(res, 400, {
        success: false,
        error: 'Message already exists',
        errorType: 'error-duplicate-message-id',
      });
      return;
    }
    const message = this.createMessage(msg.rid ?? 'unknown', msg.msg ?? '', msg._id, msg.tmid);
    this.send(res, 200, { success: true, message });
  }

  private handleMediaUpload(roomId: string, body: unknown, res: ServerResponse): void {
    if (typeof body !== 'string' || !body.includes('name="file"')) {
      this.send(res, 400, {
        success: false,
        error: 'File is required',
        errorType: 'invalid-params',
      });
      return;
    }
    this.fileCounter += 1;
    const fileId = `file-${this.fileCounter}`;
    const fileName = /filename="([^"]+)"/.exec(body)?.[1] ?? 'upload.bin';
    this.uploadedFiles.set(fileId, { roomId, name: fileName });
    this.send(res, 200, {
      success: true,
      file: { _id: fileId, url: `/file-upload/${fileId}/${encodeURIComponent(fileName)}` },
    });
  }

  private handleLegacyUpload(roomId: string, body: unknown, res: ServerResponse): void {
    if (typeof body !== 'string' || !body.includes('name="file"')) {
      this.send(res, 400, {
        success: false,
        error: 'File is required',
        errorType: 'invalid-params',
      });
      return;
    }
    this.fileCounter += 1;
    const fileId = `file-${this.fileCounter}`;
    const fileName = /filename="([^"]+)"/.exec(body)?.[1] ?? 'upload.bin';
    const message = this.createMessage(
      roomId,
      multipartField(body, 'msg') ?? '',
      undefined,
      multipartField(body, 'tmid'),
    );
    message.file = {
      _id: fileId,
      name: fileName,
      type: 'application/octet-stream',
      size: 0,
    };
    this.send(res, 200, { success: true, message });
  }

  private handleMediaConfirm(
    roomId: string,
    fileId: string,
    body: unknown,
    res: ServerResponse,
  ): void {
    const uploaded = this.uploadedFiles.get(fileId);
    if (!uploaded || uploaded.roomId !== roomId) {
      this.send(res, 400, {
        success: false,
        error: 'Uploaded file not found',
        errorType: 'error-file-not-found',
      });
      return;
    }
    const payload = (body ?? {}) as { msg?: string; tmid?: string };
    const message = this.createMessage(roomId, payload.msg ?? '', undefined, payload.tmid);
    message.file = {
      _id: fileId,
      name: uploaded.name,
      type: 'application/octet-stream',
      size: 0,
    };
    this.send(res, 200, { success: true, message });
  }

  private createMessage(rid: string, text: string, id?: string, tmid?: string): MockMessage {
    this.msgCounter += 1;
    const message: MockMessage = {
      _id: id ?? `msg-${this.msgCounter}`,
      rid,
      msg: text,
      ts: new Date(2026, 0, 1, 0, 0, this.msgCounter).toISOString(),
      u: { _id: this.botUserId, username: this.botUsername },
    };
    if (tmid) message.tmid = tmid;
    this.messages.set(message._id, message);
    return message;
  }

  private send(
    res: ServerResponse,
    status: number,
    body: unknown,
    headers?: Record<string, string>,
  ): void {
    // The client may have aborted (timeout tests); writing to a closed socket
    // would throw, so guard it.
    try {
      if (res.writableEnded || res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', ...(headers ?? {}) });
      res.end(JSON.stringify(body));
    } catch {
      /* client went away */
    }
  }
}

function parseTerm(selector: string | undefined): string {
  if (!selector) return '';
  try {
    const parsed = JSON.parse(selector) as { term?: string };
    return (parsed.term ?? '').toLowerCase();
  } catch {
    return '';
  }
}

function multipartField(body: string, name: string): string | undefined {
  const pattern = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`);
  return pattern.exec(body)?.[1];
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}
