# Tool reference

Thông thường tool trả về:

- `content`: một text block chứa JSON đã pretty-print.
- `structuredContent`: cùng dữ liệu ở dạng object (khi thành công).
- Khi lỗi: `isError: true` và `content` chứa JSON error payload (không có
  `structuredContent`).

Payload đầu ra luôn đi qua một **redaction pass** cuối cùng — token không bao giờ
xuất hiện trong kết quả tool.

---

## `rocketchat_test_connection`

Xác thực URL/credential và trả identity của bot.

**Input:** `{}`

**Output:**

```json
{
  "connected": true,
  "baseUrl": "https://chat.example.com",
  "user": { "id": "bot-user-id", "username": "coding-agent" }
}
```

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.

---

## `rocketchat_search_users`

Tìm user qua `users.autocomplete` (không dùng MongoDB query đã deprecated).

**Input:**

| Field   | Kiểu   | Ràng buộc           |
| ------- | ------ | ------------------- |
| `query` | string | 1–100 ký tự         |
| `limit` | number | 1–50, mặc định `10` |

**Output:**

```json
{
  "users": [{ "id": "u1", "username": "alice", "name": "Alice", "status": "online" }]
}
```

Chỉ trả về field an toàn: `id`, `username`, `name`, `status`.

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.

---

## `rocketchat_list_rooms`

Liệt kê room bot đã tham gia, dựa trên subscription; đã chuẩn hóa room type và lọc
qua destination policy.

**Input:**

| Field   | Kiểu   | Ràng buộc                                                    |
| ------- | ------ | ------------------------------------------------------------ |
| `types` | array  | phần tử ∈ `channel` \| `private_room` \| `direct` (tùy chọn) |
| `query` | string | ≤ 100 ký tự, lọc theo tên (tùy chọn)                         |
| `limit` | number | 1–100, mặc định `50`                                         |

**Output:**

```json
{
  "rooms": [{ "id": "GENERAL", "name": "general", "type": "channel", "encrypted": false }]
}
```

Chuẩn hóa room type: `c → channel`, `p → private_room`, `d → direct`.

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.

---

## `rocketchat_preview_message`

Render chính xác nội dung sẽ gửi nhưng không tạo side effect. Agent phải gọi tool
này trước `rocketchat_send_message`, hiển thị nguyên văn `content`, rồi mới chuyển
sang bước gửi.

**Input:** giống các field nội dung của `rocketchat_send_message`, không có
`idempotencyKey` và `dryRun`.

**Output (`structuredContent`):**

```json
{
  "sent": false,
  "preview": true,
  "destination": { "roomId": "GENERAL", "type": "channel", "name": "general" },
  "renderedText": "🤖 @alice @bob Build đã hoàn thành.",
  "previewText": "📨 **Facon → #general**\n\n> 🤖 @alice @bob Build đã hoàn thành."
}
```

**`content` hiển thị cho người dùng:**

```md
📨 **Facon → #general**

> 🤖 @alice @bob Build đã hoàn thành.
```

Với DM, nếu Rocket.Chat trả về tên hiển thị thì nhãn người nhận có dạng
`Long Duy (@longld)`; nếu không có thì dùng `@longld`. Với channel/private room,
preview ưu tiên `displayName` (ví dụ `#General Discussion`) rồi mới dùng `name`.
Phần `content` cắt preview sau 300 ký tự và thêm `...`; trường `renderedText` luôn
giữ đầy đủ nội dung thực sự sẽ gửi. Agent phải hiển thị toàn bộ `previewText`, không
được chỉ lấy `renderedText`.

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.

---

## `rocketchat_send_message`

Gửi một message tới **đúng một** đích. Có `dryRun` (mặc định `true`).

**Input:**

| Field             | Kiểu           | Ràng buộc                                          |
| ----------------- | -------------- | -------------------------------------------------- |
| `target.type`     | enum           | `channel` \| `private_room` \| `user` \| `room_id` |
| `target.value`    | string         | 1–200 ký tự                                        |
| `text`            | string         | bắt buộc, không rỗng, ≤ `MAX_TEXT_LENGTH`          |
| `format`          | enum           | `plain` (mặc định) \| `code_block`                 |
| `codeLanguage`    | string \| null | ngôn ngữ code fence, ví dụ `typescript`, `java`    |
| `mentions`        | string[]       | username hợp lệ, mặc định `[]`                     |
| `groupMention`    | enum           | `none` \| `here` \| `all`, mặc định `none`         |
| `threadMessageId` | string \| null | id message cha, mặc định `null`                    |
| `idempotencyKey`  | string \| null | ≤ 200 ký tự, mặc định `null`                       |
| `dryRun`          | boolean        | mặc định `true`                                    |

`target.type`:

- `channel`: tên public channel.
- `private_room`: tên hoặc id private room.
- `user`: username (DM).
- `room_id`: room id đã biết.

**Quy tắc:**

- Chỉ một target mỗi lần gọi; không nhận array/wildcard.
- `text` bắt buộc (không nhận message chỉ có attachment).
- Khi `format=code_block`, truyền code thô trong `text`, không tự thêm dấu
  backtick. MCP đặt `🤖` và mentions bên ngoài code fence.
- `mentions` chỉ nhận username hợp lệ; nên resolve trước bằng `rocketchat_search_users`.
- `here`/`all` phải qua feature flag; text chứa `@all`/`@here` khi flag tắt → lỗi.
- `threadMessageId` phải thuộc room đã resolve.
- Không nhận `alias`, `avatar`, attachment hay custom REST payload (bị strip).

**Output — preview (`dryRun: true`):**

```json
{
  "sent": false,
  "preview": true,
  "destination": { "roomId": "GENERAL", "type": "channel", "name": "general" },
  "renderedText": "🤖 @alice @bob Build đã hoàn thành."
}
```

**Output — đã gửi (`dryRun: false`):**

```json
{
  "sent": true,
  "duplicate": false,
  "destination": {
    "type": "direct",
    "name": "alice",
    "displayName": "Alice",
    "recipientUsername": "alice"
  },
  "message": {
    "id": "message-id",
    "roomId": "GENERAL",
    "timestamp": "2026-07-23T10:00:00.000Z"
  }
}
```

Khi gửi thành công, `content` cũng có câu xác nhận thân thiện, ví dụ
`✅ Đã gửi tin nhắn Facon cho Alice (@alice).`. Nếu server không trả về tên hiển
thị thì chỉ dùng `@recipientUsername`.

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`.
Đây là thao tác tạo external side effect khi `dryRun=false`; MCP client nên yêu cầu
người dùng duyệt trước. Workflow dành cho agent phải gọi
`rocketchat_preview_message` và hiển thị nguyên văn preview trước bước này.

---

## `rocketchat_preview_file`

Read-only step bắt buộc trước khi upload file. Tool resolve destination, kiểm tra
path allowlist, metadata/kích thước file, E2EE và thread rồi trả preview; không gọi
`rooms.media` hoặc `rooms.mediaConfirm`.

**Input:** giống các field nội dung của `rocketchat_upload_file`, không có `dryRun`.

**Output (`structuredContent`):**

```json
{
  "uploaded": false,
  "preview": true,
  "destination": { "roomId": "GENERAL", "type": "channel", "name": "general" },
  "file": { "name": "report.pdf", "size": 2048, "contentType": "application/pdf" },
  "description": "Release report",
  "renderedMessage": "🤖 Build completed",
  "previewText": "📎 **Facon → #general**\n\nFile: report.pdf (2048 bytes, application/pdf)\nMessage: 🤖 Build completed\nDescription: Release report"
}
```

`content` chứa đúng `previewText`. Agent phải hiển thị toàn bộ giá trị này nguyên
văn trước bước upload.

Annotations: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`.
Initializer tự thêm tool này vào allow/approval configuration của Codex và Claude
Code nên preview không cần human approval.

---

## `rocketchat_upload_file`

Upload đúng một file local vào đúng một destination. Rocket.Chat hiện dùng quy
trình hai bước: MCP gọi `POST /api/v1/rooms.media/:rid` bằng multipart, sau đó gọi
`POST /api/v1/rooms.mediaConfirm/:rid/:fileId` để tạo message chứa file.

**Input:**

| Field             | Kiểu           | Ràng buộc                                           |
| ----------------- | -------------- | --------------------------------------------------- |
| `target`          | object         | Giống target của `rocketchat_send_message`          |
| `filePath`        | string         | Local path, 1–4096 ký tự, phải qua path allowlist   |
| `description`     | string \| null | Mô tả file tùy chọn                                 |
| `message`         | string \| null | Message tùy chọn; MCP tự thêm `🤖`                  |
| `threadMessageId` | string \| null | Message cha phải thuộc room đích                    |
| `dryRun`          | boolean        | `false` để upload; `true` chỉ giữ tương thích ngược |

**Policy:**

- `ROCKETCHAT_ALLOWED_UPLOAD_PATHS` trống = upload bị tắt. Mỗi entry là một
  directory hoặc đúng một file; symlink được resolve trước khi so khớp.
- File phải là regular file và không vượt `ROCKETCHAT_MAX_UPLOAD_BYTES`.
- Destination vẫn qua room/DM allowlist. E2EE bị từ chối.
- DM chưa có room id bị từ chối; tool không âm thầm tạo DM mới.
- `threadMessageId` được kiểm tra bằng `chat.getMessage` trước khi upload.
- Hai write request không tự retry để tránh tạo file/message trùng.
- Timeout/network/5xx khi write trả `unknown_delivery_state` và không được tự retry.
- Tool không nhận URL, binary/base64 trực tiếp, `alias`, `avatar` hoặc custom payload.

**Output — preview (`dryRun: true`):**

```json
{
  "uploaded": false,
  "preview": true,
  "destination": { "roomId": "GENERAL", "type": "channel", "name": "general" },
  "file": { "name": "report.pdf", "size": 2048, "contentType": "application/pdf" },
  "description": "Release report",
  "renderedMessage": "🤖 Build completed"
}
```

**Output — đã upload (`dryRun: false`):**

```json
{
  "uploaded": true,
  "preview": false,
  "destination": { "roomId": "GENERAL", "type": "channel", "name": "general" },
  "file": {
    "id": "file-id",
    "url": "/file-upload/file-id/report.pdf",
    "name": "report.pdf",
    "size": 2048,
    "contentType": "application/pdf"
  },
  "message": { "id": "message-id", "roomId": "GENERAL", "timestamp": "2026-07-24T10:00:00.000Z" }
}
```

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`.
Agent phải gọi `rocketchat_preview_file`, hiển thị nguyên văn `previewText`, rồi mới
gọi tool này với cùng file details và `dryRun=false`.

---

## Error model

Error payload:

```json
{
  "error": {
    "code": "destination_not_allowed",
    "message": "The target room is not on the destination allowlist.",
    "retryable": false,
    "retryAfterMs": 2000,
    "details": { "room": "random" }
  }
}
```

| Code                           | Ý nghĩa                                    | Retryable |
| ------------------------------ | ------------------------------------------ | --------- |
| `invalid_input`                | Input sai schema/policy nội dung           | Không     |
| `authentication_failed`        | Token/user id không hợp lệ (401)           | Không     |
| `permission_denied`            | Bot thiếu quyền (403)                      | Không     |
| `destination_not_allowed`      | Đích ngoài allowlist                       | Không     |
| `destination_not_found`        | Không tìm thấy user/room (404)             | Không     |
| `ambiguous_destination`        | Nhiều đích cùng khớp                       | Không     |
| `mention_not_allowed`          | Mention bị policy chặn                     | Không     |
| `thread_room_mismatch`         | Thread message không thuộc room đích       | Không     |
| `encrypted_room_not_supported` | Room đang dùng E2EE                        | Không     |
| `rate_limited`                 | HTTP 429, kèm `retryAfterMs`               | Có        |
| `request_timeout`              | Vượt timeout                               | Có        |
| `duplicate_request`            | Idempotency key đang xử lý                 | Không     |
| `unknown_delivery_state`       | Không xác định được đã gửi hay chưa        | Không     |
| `rocketchat_error`             | Lỗi upstream đã sanitize (5xx → retryable) | Tùy       |

Error trả cho model không chứa token, header hay raw stack trace.
