# Bảo mật

Tài liệu này mô tả các kiểm soát bảo mật của MCP Server và giới hạn đã biết.

> ⚠️ **Default posture (nới lỏng theo lựa chọn của người vận hành).** Khi KHÔNG set
> các biến policy, cấu hình mặc định hiện tại cho phép: gửi mọi room bot tham gia
> (`ALLOWED_ROOMS` trống = allow-any), DM cho bất kỳ ai (`ALLOW_DM=true`, danh sách
> trống = allow-any), và `@here`/`@all` bật sẵn. Đây là default thiên về tiện dụng.
> Để theo least-privilege như khuyến nghị của plan, hãy set `ALLOW_DM=false`,
> `ALLOW_HERE_MENTION=false`, `ALLOW_ALL_MENTION=false` và liệt kê `ALLOWED_ROOMS`
> (và `ALLOWED_DM_USERS`) tường minh.

## 1. Least privilege cho bot

- Bot **không** có role `admin`.
- Bot chỉ tham gia các room nằm trong phạm vi tích hợp.
- Chỉ bật quyền tạo DM nếu use case yêu cầu (`ROCKETCHAT_ALLOW_DM`).
- Không cấp `message-impersonate`, `mention-all`, `mention-here` nếu không cần.
- Quyền tạo room / thêm thành viên / upload / sửa-xóa message chỉ được cấp khi
  triển khai Phase 2 (ngoài MVP).

## 2. Destination policy

- Room được kiểm soát bởi `ROCKETCHAT_ALLOWED_ROOMS`.
- **Room allowlist trống = allow-any** (gửi được mọi room bot đã tham gia); có liệt
  kê = chỉ những room đó. ⚠️ Để trống làm giảm least-privilege — liệt kê room cụ thể
  nếu cần siết.
- DM có ngữ nghĩa riêng: `ROCKETCHAT_ALLOW_DM` là công tắc tổng; khi bật, danh
  sách `ROCKETCHAT_ALLOWED_DM_USERS` **trống = cho phép mọi recipient**, có liệt kê
  = chỉ những người đó. ⚠️ Để trống làm giảm least-privilege — cân nhắc liệt kê
  tường minh trên workspace lớn.
- Không hỗ trợ wildcard hay nhiều đích một lần.
- Tên mơ hồ → `ambiguous_destination`, không tự chọn.
- Đích được resolve về **room id nội bộ** trước khi gửi, để kiểm tra allowlist,
  phát hiện E2EE và validate thread một cách chắc chắn.

## 3. Content & mention policy

- Giới hạn độ dài text (`ROCKETCHAT_MAX_TEXT_LENGTH`).
- Chuẩn hóa line ending về `\n` và loại bỏ ký tự điều khiển (giữ tab/newline).
- Validate username mention theo định dạng hợp lệ.
- **Không tự biến** text giống `@all`/`@here` thành group mention khi flag tắt —
  request bị từ chối thay vì để Rocket.Chat tự expand server-side.
- URL preview tắt mặc định (`parseUrls=false`).
- Không nhận URL làm `baseUrl`, `avatar`, `image_url` hay file source trong MVP.
- Không nhận `alias`/`avatar`/attachment/custom payload — client chỉ gửi field
  trong allowlist.

### File upload local

- `rocketchat_preview_file` chỉ đọc/validate metadata và destination, không gọi
  write endpoint; initializer auto-approve tool này cho Codex/Claude Code.
- Upload mặc định bị tắt; phải cấu hình `ROCKETCHAT_ALLOWED_UPLOAD_PATHS` tường minh.
- File source chỉ là local path, không nhận URL và không tự download nội dung mạng.
- MCP resolve symlink/real path trước khi so khớp allowlist, chỉ đọc regular file và
  kiểm tra `ROCKETCHAT_MAX_UPLOAD_BYTES` trước khi tạo request.
- Upload dùng hai write request (`rooms.media` rồi `rooms.mediaConfirm`) và không tự
  retry. Nếu confirm lỗi, Rocket.Chat có thể còn một media record chưa gắn message;
  operator cần dọn theo policy/version của workspace.
- Timeout/network/5xx trong write trả `unknown_delivery_state` không retryable để
  agent không tự chạy lại toàn bộ upload khi trạng thái upstream chưa rõ.
- E2EE room bị từ chối; target vẫn qua room/DM allowlist hiện có.

## 4. Secret & log

- Redact `X-Auth-Token`, `Authorization`, cookie, password và các key nhạy cảm.
- Token literal bị scrub khỏi **mọi** chuỗi log/error qua `Redactor`.
- Không log nguyên request header, không log toàn bộ environment.
- Structured JSON log **chỉ ra stderr**; stdout dành riêng cho giao thức MCP.
- Audit log của `send_message` gồm: tool name, correlation id, target type,
  room id, idempotency key **đã hash**, kết quả và message id. **Không** log full
  message text — chỉ hash/length/preview khi cần.
- Audit log của `upload_file` chỉ ghi target type, room id, tên/kích thước file,
  file/message id; không ghi full local path hoặc nội dung file.
- Payload trả cho MCP client đi qua redaction pass cuối cùng.

## 5. Prompt injection (khi mở rộng đọc history/realtime — Phase 5)

- Nội dung Rocket.Chat phải được coi là **untrusted external content**.
- Không biến nội dung message thành system/developer instruction.
- Giới hạn số lượng message và kích thước context.
- Không tự động thực thi command/URL/secret tìm thấy trong message.

## 6. E2EE

- Nếu room bật E2EE, `send_message` trả `encrypted_room_not_supported`.
- **Không** hạ cấp ngầm sang plaintext.
- Không lưu hoặc yêu cầu E2EE recovery phrase.
- E2EE được phát hiện qua cờ `encrypted` trên subscription của bot.

## 7. Idempotency & retry

- `send_message` nhận `idempotencyKey` do caller cung cấp.
- Trạng thái `pending`/`succeeded`/`failed` được lưu trong **in-memory TTL store**
  (mặc định TTL 10 phút).
- Khi có room id, ưu tiên `chat.sendMessage` với message `_id` **ổn định** suy ra
  từ idempotency key. Rocket.Chat từ chối `_id` trùng → bảo vệ cả khi process
  restart hoặc store trống.
- Chỉ **GET** request và lỗi kết nối trước khi gửi body write mới được tự retry.
  Write request **không bao giờ** tự retry.
- HTTP 429 tôn trọng `x-ratelimit-reset`, trả `rate_limited` kèm `retryAfterMs`.
- Nếu không xác định được kết quả gửi → `unknown_delivery_state`; không tự gửi lần 2.

### Giới hạn đã biết của idempotency store

In-memory store **mất trạng thái khi process restart** và **không chia sẻ giữa
nhiều instance**. Lớp bảo vệ cross-restart hiện dựa vào việc Rocket.Chat từ chối
message `_id` trùng. Đường gửi DM mới (chưa có room) dùng `chat.postMessage`, nên
**không** có `_id` ổn định → chống trùng chỉ ở mức best-effort trong cùng process.
**Trước khi triển khai remote/multi-instance**, thay bằng Redis hoặc persistent
store dùng chung.

## 8. Checklist nghiệm thu bảo mật

- [ ] Token không xuất hiện trong source, stdout, log, test snapshot hay error.
- [ ] Room allowlist: trống = allow-any, có liệt kê = chỉ room đó. DM tuân theo
      `ALLOW_DM` + allowlist (trống = allow-any khi bật).
- [ ] `@all`/`@here`/DM/room ngoài allowlist bị chặn theo cấu hình.
- [ ] E2EE room bị từ chối, không hạ cấp plaintext.
- [ ] HTTP 429 trả lỗi có `retryAfterMs`.
- [ ] Retry không tạo message trùng trong các case đã xác định.
- [ ] Config sai làm process fail với thông báo đã sanitize.
