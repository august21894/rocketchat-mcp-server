# Kế hoạch phát triển Rocket.Chat MCP Server

## 1. Mục tiêu

Xây dựng một MCP Server cho Coding Agent có khả năng tương tác an toàn với
Rocket.Chat thông qua REST API.

Phiên bản MVP phải hỗ trợ:

- Kiểm tra kết nối và thông tin tài khoản bot.
- Tìm người dùng theo username hoặc tên hiển thị.
- Liệt kê các room mà bot có quyền truy cập.
- Gửi tin nhắn tới public channel.
- Gửi tin nhắn tới private channel/group mà bot đã tham gia.
- Gửi direct message tới một người dùng.
- Mention người dùng bằng `@username`.
- Tùy chọn mention `@here` và `@all` khi được cấu hình cho phép.
- Gửi reply vào thread bằng message ID gốc.
- Xem trước request bằng `dryRun` trước khi tạo tác động bên ngoài.
- Chống gửi trùng ở mức phù hợp với mô hình triển khai.

MCP phải hoạt động với cả Rocket.Chat self-hosted và Rocket.Chat Cloud, miễn là
REST API của workspace có thể được MCP Server truy cập.

## 2. Phạm vi

### 2.1. Trong phạm vi MVP

- TypeScript trên Node.js LTS.
- Official MCP TypeScript SDK.
- MCP transport `stdio` cho Coding Agent chạy local.
- Rocket.Chat REST API.
- Một bot account và một Personal Access Token.
- Một destination cho mỗi lần gọi tool.
- Text message, user mention, group mention và thread reply.
- Target allowlist, rate-limit handling, audit log đã che thông tin nhạy cảm.
- Unit test, HTTP contract test và integration test với Rocket.Chat test
  workspace.

### 2.2. Ngoài phạm vi MVP

- Đọc hoặc gửi nội dung trong E2EE room.
- Nhận message theo thời gian thực qua WebSocket.
- Chạy MCP remote nhiều tenant.
- OAuth theo từng người dùng cuối.
- Gửi cùng lúc tới nhiều room.
- Mạo danh người gửi bằng `alias` hoặc `avatar`.
- Quản trị workspace, role, permission hoặc user.
- Omnichannel/Livechat.
- Voice, video call và federation.

Các chức năng tạo room, quản lý thành viên, upload file, đọc lịch sử, sửa và
xóa tin nhắn được đưa vào giai đoạn mở rộng sau MVP.

## 3. Quyết định kiến trúc

### 3.1. Kiến trúc tổng thể

```text
Coding Agent
    |
    | MCP over stdio
    v
Rocket.Chat MCP Server
    |
    +-- Tool definitions và input validation
    +-- Policy/allowlist/confirmation guard
    +-- Target resolver
    +-- Rocket.Chat REST client
    +-- Rate-limit và error mapper
    +-- Redacted audit logger
    |
    | HTTPS + X-User-Id + X-Auth-Token
    v
Rocket.Chat Workspace
```

MCP layer không được gọi HTTP trực tiếp. Tất cả request phải đi qua
`RocketChatClient`, để timeout, authentication, rate limiting, error mapping và
logging được áp dụng nhất quán.

### 3.2. REST thay cho DDP method calls

Sử dụng REST API cho toàn bộ write operation. Không sử dụng DDP method calls vì
Rocket.Chat đã đánh dấu nhóm API này là deprecated.

WebSocket subscription chỉ được xem xét trong phiên bản sau nếu có yêu cầu
Coding Agent nhận message hoặc event theo thời gian thực.

### 3.3. Mô hình định danh

MVP sử dụng một Rocket.Chat bot account dùng chung:

- Bot có tên và avatar rõ ràng để người nhận biết message do automation gửi.
- Bot chỉ được tham gia các room nằm trong phạm vi tích hợp.
- Bot không có role `admin`.
- Personal Access Token được nạp từ environment hoặc secret manager.
- Username/password không được lưu trong project và không được nhận qua MCP
  tool input.

Nếu MCP được chuyển thành dịch vụ remote cho nhiều người dùng, thiết kế phải
chuyển sang OAuth và ánh xạ từng MCP principal với một Rocket.Chat identity.

## 4. Cấu trúc source dự kiến

```text
.
├── src/
│   ├── index.ts
│   ├── server/
│   │   ├── create-server.ts
│   │   └── tool-annotations.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── schema.ts
│   ├── rocketchat/
│   │   ├── client.ts
│   │   ├── types.ts
│   │   ├── endpoints.ts
│   │   ├── errors.ts
│   │   └── rate-limit.ts
│   ├── services/
│   │   ├── connection-service.ts
│   │   ├── room-service.ts
│   │   ├── user-service.ts
│   │   ├── message-service.ts
│   │   ├── target-resolver.ts
│   │   └── idempotency-service.ts
│   ├── policies/
│   │   ├── destination-policy.ts
│   │   ├── mention-policy.ts
│   │   └── content-policy.ts
│   ├── tools/
│   │   ├── test-connection.ts
│   │   ├── search-users.ts
│   │   ├── list-rooms.ts
│   │   └── send-message.ts
│   └── observability/
│       ├── logger.ts
│       └── redaction.ts
├── test/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   └── fixtures/
├── docs/
│   ├── configuration.md
│   ├── security.md
│   └── tool-reference.md
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## 5. Cấu hình

### 5.1. Environment variables

```env
ROCKETCHAT_BASE_URL=https://chat.example.com
ROCKETCHAT_USER_ID=bot-user-id
ROCKETCHAT_AUTH_TOKEN=secret-token

ROCKETCHAT_ALLOWED_ROOMS=general,engineering,room-id-1
ROCKETCHAT_ALLOW_DM=true
ROCKETCHAT_ALLOWED_DM_USERS=
ROCKETCHAT_ALLOW_HERE_MENTION=false
ROCKETCHAT_ALLOW_ALL_MENTION=false

ROCKETCHAT_MAX_TEXT_LENGTH=4000
ROCKETCHAT_REQUEST_TIMEOUT_MS=10000
ROCKETCHAT_DISABLE_URL_PREVIEW=true

MCP_TRANSPORT=stdio
LOG_LEVEL=info
```

### 5.2. Quy tắc cấu hình

- `ROCKETCHAT_BASE_URL` là cấu hình khởi động, không được truyền từ tool input.
- Bắt buộc dùng HTTPS, ngoại trừ `localhost` trong môi trường development.
- Server phải fail fast nếu thiếu URL, user ID hoặc token.
- Token phải được redact khỏi log và error message.
- Không log toàn bộ environment.
- Allowlist trống phải được hiểu là deny-all, không phải allow-all.
- `@here`, `@all` và DM bị tắt theo mặc định.

## 6. MCP tool contracts

### 6.1. `rocketchat_test_connection`

Mục đích:

- Kiểm tra URL, credential và khả năng gọi REST API.
- Trả về identity đã xác thực và thông tin workspace an toàn nếu API hỗ trợ.
- Không trả về token, session hoặc dữ liệu người dùng không cần thiết.

Input:

```json
{}
```

Output tối thiểu:

```json
{
  "connected": true,
  "baseUrl": "https://chat.example.com",
  "user": {
    "id": "bot-user-id",
    "username": "coding-agent"
  }
}
```

Tool annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: true`

### 6.2. `rocketchat_search_users`

Mục đích:

- Tìm user trước khi gửi DM hoặc mention.
- Sử dụng `users.autocomplete`; không phụ thuộc vào các query parameter MongoDB
  đã deprecated.

Input:

```json
{
  "query": "alice",
  "limit": 10
}
```

Ràng buộc:

- `query`: 1-100 ký tự.
- `limit`: 1-50, mặc định 10.
- Chỉ trả về `_id`, `username`, `name`, `status` và các field an toàn cần thiết.

Tool annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: true`

### 6.3. `rocketchat_list_rooms`

Mục đích:

- Liệt kê room mà bot đã tham gia.
- Dùng dữ liệu subscription để lấy `rid`, tên và room type.

Input:

```json
{
  "types": ["channel", "private_room", "direct"],
  "query": "engineering",
  "limit": 50
}
```

Output cần chuẩn hóa room type của Rocket.Chat:

- `c` thành `channel`.
- `p` thành `private_room`.
- `d` thành `direct`.

Chỉ trả về room mà destination policy cho phép agent nhìn thấy.

Tool annotations:

- `readOnlyHint: true`
- `destructiveHint: false`
- `openWorldHint: true`

### 6.4. `rocketchat_send_message`

Mục đích:

- Gửi một message tới đúng một destination.
- Hỗ trợ mention và thread reply.
- Có chế độ preview qua `dryRun`.

Input:

```json
{
  "target": {
    "type": "channel",
    "value": "engineering"
  },
  "text": "Build đã hoàn thành.",
  "mentions": ["alice", "bob"],
  "groupMention": "none",
  "threadMessageId": null,
  "idempotencyKey": "deploy-2026-07-23-build-184",
  "dryRun": true
}
```

`target.type` hợp lệ:

- `channel`: public channel name.
- `private_room`: private room name hoặc ID.
- `user`: Rocket.Chat username.
- `room_id`: room ID đã biết.

Quy tắc:

- Chỉ một target cho mỗi call.
- `text` bắt buộc, không nhận message chỉ có attachment trong MVP.
- `mentions` chỉ nhận username hợp lệ đã được resolve.
- `groupMention` nhận `none`, `here` hoặc `all`.
- `here` và `all` phải qua feature flag và permission check.
- `threadMessageId` phải thuộc destination đã resolve.
- `dryRun` mặc định là `true` trong tool schema.
- URL preview mặc định bị tắt.
- Không nhận `alias`, `avatar`, arbitrary attachment hoặc custom REST payload.

Output khi preview:

```json
{
  "sent": false,
  "preview": true,
  "destination": {
    "roomId": "room-id",
    "type": "channel",
    "name": "engineering"
  },
  "renderedText": "@alice @bob Build đã hoàn thành."
}
```

Output khi gửi:

```json
{
  "sent": true,
  "duplicate": false,
  "message": {
    "id": "message-id",
    "roomId": "room-id",
    "timestamp": "2026-07-23T10:00:00.000Z"
  }
}
```

Tool annotations:

- `readOnlyHint: false`
- `destructiveHint: false`
- `openWorldHint: true`

Mô tả tool phải nói rõ đây là thao tác tạo external side effect và MCP client
nên yêu cầu người dùng duyệt trước khi thực thi với `dryRun=false`.

## 7. Mapping sang Rocket.Chat API

| Chức năng | REST API |
|---|---|
| Gửi theo channel name hoặc username | `POST /api/v1/chat.postMessage` |
| Gửi theo room ID, hỗ trợ custom message ID | `POST /api/v1/chat.sendMessage` |
| Tìm user | `GET /api/v1/users.autocomplete` |
| Lấy room/subscription của bot | `GET /api/v1/subscriptions.get` |
| Kiểm tra một message | `GET /api/v1/chat.getMessage` |
| Tạo private group, phase 2 | `POST /api/v1/groups.create` |
| Mời thành viên, phase 2 | `POST /api/v1/groups.invite` |
| Upload file, phase 2 | `POST /api/v1/rooms.media/{rid}` và confirm |
| Sửa message, phase 2 | `POST /api/v1/chat.update` |
| Xóa message, phase 2 | `POST /api/v1/chat.delete` |

Target resolver phải ưu tiên room ID nội bộ sau khi resolve để:

- Phân biệt chính xác public, private và direct room.
- Kiểm tra allowlist trước khi gửi.
- Phát hiện E2EE room và từ chối trong MVP.
- Kiểm tra thread message thuộc đúng room.
- Cho phép dùng `chat.sendMessage` với một message `_id` chủ động khi workspace
  hỗ trợ.

## 8. Idempotency và retry

Gửi message là external side effect nên không được retry mù.

Thiết kế:

1. Tool nhận `idempotencyKey` do caller cung cấp.
2. MCP lưu trạng thái `pending`, `succeeded` hoặc `failed` cho key trong một TTL
   store.
3. Nếu target đã resolve thành room ID, ưu tiên `chat.sendMessage` với message
   `_id` ổn định được ánh xạ từ idempotency key.
4. Nếu Rocket.Chat trả về success nhưng MCP mất kết nối trước khi nhận response,
   MCP kiểm tra message ID trước khi gửi lại.
5. Nếu không thể xác định kết quả, trả trạng thái `unknown`; không tự gửi lần
   thứ hai.

MVP local có thể dùng in-memory TTL store, nhưng phải mô tả rõ giới hạn khi
process restart. Trước khi triển khai remote hoặc nhiều instance, thay bằng
Redis hoặc persistent store dùng chung.

Chỉ tự retry các GET request và lỗi kết nối xảy ra trước khi body của write
request được gửi. HTTP 429 phải tôn trọng `x-ratelimit-reset`.

## 9. Security controls

### 9.1. Least privilege

- Bot không có quyền admin.
- Chỉ tham gia các room cần thiết.
- Chỉ bật quyền tạo DM nếu MCP được phép bắt đầu DM.
- Không cấp `message-impersonate`.
- Không cấp `mention-all` hoặc `mention-here` nếu use case không yêu cầu.
- Quyền tạo room và thêm thành viên chỉ được cấp khi phase 2 được bật.

### 9.2. Destination policy

- Room name và room ID phải qua allowlist.
- Có allowlist riêng cho DM recipient.
- Không hỗ trợ wildcard destination trong MVP.
- Không hỗ trợ array destination.
- Resolve tên mơ hồ phải trả lỗi, không tự chọn kết quả đầu tiên.

### 9.3. Content policy

- Giới hạn độ dài message.
- Validate username mention.
- Không tự động biến text giống `@all` hoặc `@here` thành group mention nếu
  feature tương ứng đang tắt.
- Tắt URL preview mặc định.
- Không nhận URL làm `baseUrl`, `avatar`, `image_url` hoặc file source trong MVP.
- Chuẩn hóa line ending và loại bỏ ký tự điều khiển không cần thiết.

### 9.4. Secret và log

- Redact `X-Auth-Token`, `Authorization`, cookie và query nhạy cảm.
- Không log nguyên request header.
- Audit log gồm tool name, actor/session ID nếu có, destination, timestamp,
  idempotency key, result và Rocket.Chat message ID.
- Không log full message text ở production; chỉ log hash, length hoặc preview đã
  truncate.

### 9.5. Prompt injection

Khi bổ sung history hoặc realtime message:

- Nội dung Rocket.Chat phải được đánh dấu là untrusted external content.
- Không chuyển nội dung message thành system/developer instruction.
- Giới hạn số lượng message và kích thước context.
- Không tự động thực thi command, URL hoặc secret được tìm thấy trong message.

### 9.6. E2EE

Nếu room có E2EE:

- `send_message` trả lỗi `encrypted_room_not_supported`.
- Không hạ cấp sang plaintext một cách ngầm định.
- Không lưu hoặc yêu cầu E2EE recovery phrase trong MCP MVP.

## 10. Error model

Mọi tool trả lỗi có cấu trúc và `isError: true`.

Các error code nội bộ:

| Code | Ý nghĩa |
|---|---|
| `invalid_input` | Input không đúng schema |
| `authentication_failed` | Token hoặc user ID không hợp lệ |
| `permission_denied` | Bot thiếu permission |
| `destination_not_allowed` | Target không thuộc allowlist |
| `destination_not_found` | Không tìm thấy user/room |
| `ambiguous_destination` | Có nhiều target cùng khớp |
| `mention_not_allowed` | Mention bị policy chặn |
| `thread_room_mismatch` | Thread message không thuộc target room |
| `encrypted_room_not_supported` | Room đang dùng E2EE |
| `rate_limited` | Rocket.Chat trả HTTP 429 |
| `request_timeout` | Request vượt timeout |
| `duplicate_request` | Idempotency key đã được xử lý |
| `unknown_delivery_state` | Không xác định được message đã gửi hay chưa |
| `rocketchat_error` | Lỗi upstream đã được sanitize |

Error trả cho model phải có:

- Thông báo ngắn, có thể hành động.
- Trạng thái có retry được hay không.
- `retryAfterMs` nếu có.
- Không chứa token, header hoặc raw stack trace.

## 11. Test strategy

### 11.1. Unit tests

- Environment validation.
- URL và HTTPS policy.
- Allowlist parsing và deny-all default.
- Target normalization.
- User/channel/private room/room ID resolution.
- Mention rendering và feature flags.
- Thread-room validation.
- Message length và control-character validation.
- Secret redaction.
- Rocket.Chat error mapping.
- Rate-limit header parsing.
- Idempotency state transitions.

### 11.2. HTTP contract tests

Mock Rocket.Chat REST API để kiểm tra:

- Header authentication được gắn đúng.
- Timeout và abort signal.
- Payload `chat.postMessage`.
- Payload `chat.sendMessage`.
- Không gửi `alias`, `avatar` hoặc field ngoài schema.
- `parseUrls=false` hoặc `previewUrls=[]`.
- Mapping 401, 403, 404, 429 và 5xx.
- Không retry write request khi delivery state không chắc chắn.

### 11.3. Integration tests

Chuẩn bị một Rocket.Chat test workspace hoặc container với:

- Một bot user.
- Một public channel.
- Một private channel có bot.
- Một private channel không có bot.
- Hai user dùng cho DM và mention.
- Một read-only room.
- Một E2EE private room nếu môi trường test hỗ trợ.

Test cases:

1. Kết nối bằng credential đúng và sai.
2. Tìm user.
3. Liệt kê room đã tham gia.
4. Preview message không tạo message thật.
5. Gửi public channel.
6. Gửi private room.
7. Gửi DM.
8. Mention một và nhiều user.
9. Chặn `@all` và `@here` theo default policy.
10. Gửi thread reply.
11. Chặn room ngoài allowlist.
12. Chặn E2EE room.
13. Xử lý rate limit.
14. Gọi lại cùng idempotency key không gửi trùng.

### 11.4. MCP end-to-end tests

- Chạy server qua `stdio`.
- Dùng MCP Inspector hoặc test client gọi `tools/list`.
- Validate schema và annotations của cả bốn tools.
- Gọi read-only tools.
- Gọi `send_message` với `dryRun=true`.
- Chỉ trong test workspace mới gọi `dryRun=false`.
- Kiểm tra process shutdown sạch khi client đóng transport.

## 12. Observability

MVP cần:

- Structured JSON logs ra `stderr` để không làm hỏng MCP `stdio`.
- Request correlation ID.
- Idempotency key đã hash.
- Duration và status của Rocket.Chat request.
- Rate-limit remaining/reset.
- Số lần tool thành công, thất bại và bị policy từ chối.

Không ghi log protocol ra `stdout` ngoài dữ liệu MCP.

Khi triển khai remote, bổ sung metrics:

- Tool call count và latency.
- Rocket.Chat error rate.
- Rate-limit events.
- Unknown delivery states.
- Destination-policy denials.

## 13. Các giai đoạn triển khai

### Phase 0 — Xác nhận môi trường

Deliverables:

- Ghi nhận Rocket.Chat base URL và server version.
- Xác nhận self-hosted hay Cloud.
- Tạo bot account.
- Lập permission matrix cho bot.
- Tạo PAT và lưu vào secret manager.
- Chốt room/DM allowlist.
- Kiểm tra E2EE có được bật mặc định cho DM/private room hay không.

Exit criteria:

- Có test workspace và credential không phải admin.
- Gọi thử authentication và một read-only endpoint thành công.

### Phase 1 — Scaffold MCP Server

Tasks:

- Khởi tạo TypeScript project và lockfile.
- Cài MCP SDK, Zod, test runner, linter và formatter.
- Thiết lập strict TypeScript.
- Tạo server chạy qua `stdio`.
- Tạo config schema, secret redaction và structured logger.
- Thêm graceful shutdown.
- Thêm CI cho lint, typecheck và unit tests.

Exit criteria:

- MCP client gọi được `tools/list`.
- Server không ghi log ứng dụng vào `stdout`.
- Config sai làm process fail với thông báo đã sanitize.

### Phase 2 — Rocket.Chat REST client

Tasks:

- Tạo typed HTTP client.
- Thêm authentication headers.
- Thêm timeout và abort.
- Parse Rocket.Chat error response.
- Parse rate-limit headers.
- Implement user autocomplete và subscriptions.
- Viết HTTP contract tests.

Exit criteria:

- `rocketchat_test_connection`, `rocketchat_search_users` và
  `rocketchat_list_rooms` hoạt động trong test workspace.

### Phase 3 — Message workflow

Tasks:

- Implement target resolver.
- Implement destination, mention và content policies.
- Implement dry-run rendering.
- Implement send qua `chat.postMessage`/`chat.sendMessage`.
- Implement thread validation.
- Implement idempotency service.
- Trả output đã chuẩn hóa, không lộ raw upstream payload.

Exit criteria:

- Gửi được public channel, private room và DM.
- Mention user hoạt động.
- `@all`/`@here` bị chặn theo mặc định.
- Không gửi trùng khi gọi lại cùng idempotency key trong cùng process.

### Phase 4 — Hardening và nghiệm thu

Tasks:

- Chạy integration test matrix.
- Kiểm tra token không xuất hiện trong log hoặc error.
- Kiểm tra allowlist deny-by-default.
- Kiểm tra rate limit và timeout.
- Kiểm tra E2EE room bị từ chối.
- Viết README, configuration, security và tool reference.
- Tạo `.env.example` không chứa secret.
- Chạy MCP Inspector.

Exit criteria:

- Tất cả acceptance criteria của MVP đạt.
- Không còn lỗi severity cao trong security review.
- Có hướng dẫn cấu hình cho Coding Agent mục tiêu.

### Phase 5 — Các phần mở rộng

Ưu tiên đề xuất:

1. Upload file từ local workspace với path allowlist.
2. Tạo private room và mời thành viên.
3. Đọc history với prompt-injection boundary.
4. Update/delete message với confirmation mạnh hơn.
5. WebSocket subscription cho realtime event.
6. Streamable HTTP transport và MCP OAuth.
7. Multi-workspace/multi-tenant credential isolation.
8. Persistent/distributed idempotency store.

Mỗi write tool mới phải có allowlist, audit log, dry-run hoặc confirmation phù
hợp và test quyền Rocket.Chat tương ứng.

## 14. Ước lượng tương đối

| Hạng mục | Ước lượng |
|---|---:|
| Phase 0: môi trường và permission | 0.5-1 ngày kỹ sư |
| Phase 1: scaffold MCP | 1 ngày kỹ sư |
| Phase 2: REST client và read tools | 1-2 ngày kỹ sư |
| Phase 3: message workflow | 2-3 ngày kỹ sư |
| Phase 4: hardening, test, tài liệu | 1-2 ngày kỹ sư |
| Tổng MVP | 5.5-9 ngày kỹ sư |

Ước lượng giả định đã có Rocket.Chat test workspace, quyền tạo bot/PAT và không
bao gồm E2EE, remote OAuth hoặc quy trình security approval của doanh nghiệp.

## 15. Acceptance criteria

MVP được coi là hoàn thành khi:

- Coding Agent khám phá được bốn MCP tools.
- Tool input/output có schema rõ ràng và strict validation.
- Kết nối được Rocket.Chat bằng bot PAT.
- Tìm được user mà không dùng deprecated MongoDB query parameters.
- Liệt kê được các room bot đã tham gia và policy cho phép.
- Preview message không tạo side effect.
- Gửi được một message tới public channel.
- Gửi được một message tới private room bot đã tham gia.
- Gửi được một DM tới user được phép.
- Mention user hoạt động.
- Thread reply xuất hiện đúng thread.
- `@all`, `@here`, DM và room ngoài allowlist bị chặn theo cấu hình.
- Không hỗ trợ hoặc tự hạ cấp E2EE room sang plaintext.
- Token không xuất hiện trong source, stdout, log, test snapshot hoặc error.
- HTTP 429 được trả thành lỗi có `retryAfterMs`.
- Retry không tạo message trùng trong các trường hợp đã xác định.
- Unit, contract, integration và MCP end-to-end tests đều pass.
- Có tài liệu setup, permission, security và troubleshooting.

## 16. Các quyết định cần chốt trước khi code

Nếu chưa có câu trả lời, dùng giá trị mặc định được đề xuất:

| Câu hỏi | Mặc định đề xuất |
|---|---|
| MCP chạy local hay remote? | Local `stdio` |
| Một bot chung hay identity theo user? | Một bot chung cho MVP |
| DM có được bật không? | Bật, nhưng có recipient allowlist |
| Cho phép `@here`/`@all`? | Tắt |
| Cho phép gửi nhiều room một lần? | Không |
| Có bắt buộc dry-run trước khi gửi? | MCP client yêu cầu approval; tool mặc định `dryRun=true` |
| Có hỗ trợ E2EE? | Không |
| Có đọc message/history? | Không trong MVP |
| Idempotency store? | In-memory cho local MVP, persistent trước production remote |

## 17. Tài liệu tham khảo

- [Rocket.Chat API](https://developer.rocket.chat/apidocs)
- [Rocket.Chat authentication](https://developer.rocket.chat/apidocs/authentication-api)
- [Post message](https://developer.rocket.chat/apidocs/post-message)
- [Send message](https://developer.rocket.chat/apidocs/send-message)
- [Autocomplete user](https://developer.rocket.chat/apidocs/autocomplete-user)
- [Get subscriptions](https://developer.rocket.chat/apidocs/get-all-subscriptions)
- [Rocket.Chat permissions](https://docs.rocket.chat/docs/permissions)
- [Rocket.Chat E2EE specifications](https://docs.rocket.chat/docs/end-to-end-encryption-specifications)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server)
- [MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
