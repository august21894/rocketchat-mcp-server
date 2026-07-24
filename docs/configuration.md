# Cấu hình

Toàn bộ cấu hình đến từ **environment variables**. Không có giá trị nào được
truyền qua tool input. Server **fail fast** với thông báo đã sanitize (không bao
giờ in ra giá trị/token) nếu cấu hình sai.

## Nguồn cấu hình & thứ tự ưu tiên

Server tự phân giải cấu hình theo thứ tự (cao → thấp):

1. **Biến môi trường hệ thống** (`process.env`) — **luôn ưu tiên cao nhất**.
2. **File `.env`** — chỉ dùng làm _fallback_ cho những key **chưa** có trong env
   hệ thống. Vị trí file: `ROCKETCHAT_ENV_FILE` nếu được set, ngược lại `<cwd>/.env`.

Nhờ vậy, khi cài như một package (`npm install`) bạn chỉ cần **export env hệ thống**
(hoặc trỏ `ROCKETCHAT_ENV_FILE` tới một file) — không bắt buộc dùng cờ `--env-file`
của Node và một `.env` lỡ commit cũng **không thể** ghi đè secret bạn set từ hệ thống.
`ROCKETCHAT_BASE_URL`, `ROCKETCHAT_USER_ID`, `ROCKETCHAT_AUTH_TOKEN` vì thế luôn lấy
từ hệ thống trước nếu có.

> Nếu chạy qua MCP client (Claude/Codex), tiến trình được spawn với `cwd` bất kỳ,
> nên `<cwd>/.env` có thể không tìm thấy. Khi đó hãy set `ROCKETCHAT_ENV_FILE` (đường
> dẫn tuyệt đối) trong khối `env` của client, hoặc set thẳng các biến `ROCKETCHAT_*`.

## Bảng biến môi trường

| Biến                              | Bắt buộc | Mặc định                         | Ý nghĩa                                                                                      |
| --------------------------------- | -------- | -------------------------------- | -------------------------------------------------------------------------------------------- |
| `ROCKETCHAT_BASE_URL`             | ✅       | —                                | URL workspace. HTTPS bắt buộc, trừ `localhost`/`127.0.0.1`/`::1`. Trailing slash bị loại bỏ. |
| `ROCKETCHAT_USER_ID`              | ✅       | —                                | User id của bot (`X-User-Id`).                                                               |
| `ROCKETCHAT_AUTH_TOKEN`           | ✅       | —                                | Personal Access Token của bot (`X-Auth-Token`).                                              |
| `ROCKETCHAT_WORKSPACE_NAME`       | —        | hostname của Base URL            | Tên workspace dùng trong MCP instructions và mô tả tools, ví dụ `Facon`.                     |
| `ROCKETCHAT_ALLOWED_ROOMS`        | —        | _(trống = allow-any room)_       | Danh sách tên và/hoặc id room, ngăn cách bằng dấu phẩy.                                      |
| `ROCKETCHAT_ALLOW_DM`             | —        | `true`                           | Công tắc tổng cho direct message.                                                            |
| `ROCKETCHAT_ALLOWED_DM_USERS`     | —        | _(trống = allow-any khi DM bật)_ | Danh sách username được phép nhận DM.                                                        |
| `ROCKETCHAT_ALLOW_HERE_MENTION`   | —        | `true`                           | Cho phép `@here`.                                                                            |
| `ROCKETCHAT_ALLOW_ALL_MENTION`    | —        | `true`                           | Cho phép `@all`.                                                                             |
| `ROCKETCHAT_MAX_TEXT_LENGTH`      | —        | `10000`                          | Độ dài tối đa của text (1–40000).                                                            |
| `ROCKETCHAT_REQUEST_TIMEOUT_MS`   | —        | `10000`                          | Timeout mỗi request (1000–120000).                                                           |
| `ROCKETCHAT_DISABLE_URL_PREVIEW`  | —        | `true`                           | Tắt URL preview (`parseUrls=false`).                                                         |
| `ROCKETCHAT_ALLOWED_UPLOAD_PATHS` | —        | _(trống = tắt upload)_           | File/thư mục local được phép đọc để upload, ngăn cách bằng dấu phẩy.                         |
| `ROCKETCHAT_MAX_UPLOAD_BYTES`     | —        | `26214400` (25 MiB)              | Kích thước file tối đa phía MCP (1 byte–1 GiB). Rocket.Chat có thể đặt giới hạn thấp hơn.    |
| `MCP_TRANSPORT`                   | —        | `stdio`                          | Chỉ hỗ trợ `stdio` trong MVP.                                                                |
| `LOG_LEVEL`                       | —        | `info`                           | `debug` \| `info` \| `warn` \| `error`.                                                      |

### Giá trị boolean

Chấp nhận (không phân biệt hoa/thường): `true/false`, `1/0`, `yes/no`, `on/off`.
Giá trị rỗng dùng mặc định. Giá trị khác → lỗi cấu hình.

## Quy tắc cấu hình

1. **`ROCKETCHAT_BASE_URL` là cấu hình khởi động**, không nhận từ tool input.
2. **HTTPS bắt buộc**, ngoại trừ loopback cho development.
3. **Fail fast**: thiếu URL, user id hoặc token → process thoát với mã ≠ 0.
4. **Token được redact** khỏi log và error. Không log toàn bộ environment.
5. **Tên workspace là metadata**: `ROCKETCHAT_WORKSPACE_NAME` chỉ giúp agent nhận
   diện workspace trong server instructions và mô tả tools. Biến này không thay
   đổi URL hoặc credential; nếu để trống server dùng hostname của Base URL.
6. **Room allowlist trống = allow-any**: `ROCKETCHAT_ALLOWED_ROOMS` trống → gửi được
   **mọi room bot đã tham gia**; có liệt kê → chỉ những room đó.
7. **DM có ngữ nghĩa riêng** (xem mục dưới): `ROCKETCHAT_ALLOW_DM` là công tắc tổng;
   khi bật, danh sách recipient trống nghĩa là **cho phép mọi người**.
8. **Default hiện tại nới lỏng** (đồng bộ với `.env` mẫu): `ALLOW_DM`, `@here`, `@all`
   đều **bật** khi không set. Set `false` tường minh nếu muốn siết.
9. **Upload local mặc định bị tắt**: `ROCKETCHAT_ALLOWED_UPLOAD_PATHS` trống khiến
   mọi lệnh `rocketchat_upload_file` bị từ chối. Mỗi path có thể là một thư mục
   (cho phép file con) hoặc đúng một file. Symlink được resolve về real path trước
   khi kiểm tra để không thoát khỏi allowlist.

## File upload allowlist

Ví dụ chỉ cho phép artifact trong workspace và một file báo cáo cụ thể:

```env
ROCKETCHAT_ALLOWED_UPLOAD_PATHS=/workspace/project/dist,/workspace/reports/release.pdf
ROCKETCHAT_MAX_UPLOAD_BYTES=26214400
```

- Path tương đối được resolve theo working directory của tiến trình MCP; với GUI
  client nên dùng path tuyệt đối để tránh phụ thuộc `cwd`.
- Tool chỉ đọc regular file, không đọc directory.
- Kết quả tool và audit log chỉ chứa tên/kích thước file, không trả full local path.
- Giới hạn này là lớp bảo vệ phía MCP; giới hạn upload cấu hình trong Rocket.Chat
  vẫn được áp dụng độc lập.

## Room allowlist hoạt động thế nào

- **Trống → cho phép mọi room** bot đã tham gia (giống DM allowlist).
- **Có liệt kê →** một room chỉ được phép nếu **id** của nó, hoặc **tên** (so khớp
  không phân biệt hoa/thường) nằm trong `ROCKETCHAT_ALLOWED_ROOMS`.
- Không hỗ trợ wildcard, không hỗ trợ nhiều đích trong một lần gọi.
- Tên mơ hồ (nhiều room trùng tên bot đã tham gia) → lỗi `ambiguous_destination`,
  server không tự chọn kết quả đầu tiên.

> ⚠️ **Lưu ý bảo mật:** để trống `ROCKETCHAT_ALLOWED_ROOMS` nghĩa là agent có thể
> gửi vào **bất kỳ room nào** bot đang tham gia. Liệt kê room cụ thể nếu muốn siết
> theo least-privilege.

## DM allowlist hoạt động thế nào

DM được kiểm soát bởi **hai lớp**:

1. `ROCKETCHAT_ALLOW_DM` — công tắc tổng. `false` → cấm mọi DM.
2. `ROCKETCHAT_ALLOWED_DM_USERS` — danh sách người nhận:
   - **Trống** (và DM đang bật) → **cho phép gửi cho bất kỳ user nào**.
   - **Có liệt kê** → chỉ cho phép đúng những username trong danh sách.

| `ALLOW_DM` | `ALLOWED_DM_USERS` | Kết quả                         |
| ---------- | ------------------ | ------------------------------- |
| `false`    | bất kỳ             | Cấm mọi DM                      |
| `true`     | _(trống)_          | Gửi DM cho **bất kỳ ai**        |
| `true`     | `alice,bob`        | Chỉ gửi DM cho `alice` và `bob` |

> ⚠️ **Lưu ý bảo mật:** để trống danh sách nghĩa là agent có thể DM bất kỳ ai
> trong workspace. Với workspace lớn, cân nhắc liệt kê tường minh người nhận để
> giữ nguyên tắc least-privilege.

## Tạo Personal Access Token cho bot

1. Đăng nhập bằng tài khoản bot (không có role `admin`).
2. **My Account → Personal Access Tokens → Add**.
3. Lưu `userId` và `authToken` trả về vào secret manager.
4. Chỉ mời bot vào các room nằm trong phạm vi tích hợp.

Xem thêm mô hình quyền và bảo mật ở [`security.md`](security.md).
