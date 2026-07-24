# Rocket.Chat MCP Server

MCP Server cho Coding Agent tương tác **an toàn** với Rocket.Chat qua REST API.
Bản MVP hỗ trợ kiểm tra kết nối, tìm user, liệt kê room và gửi message (kèm
mention, thread reply, dry-run và chống gửi trùng) tới đúng một đích mỗi lần gọi.

- Transport: MCP `stdio` (chạy local cùng Coding Agent).
- Ngôn ngữ: TypeScript trên Node.js LTS (khuyến nghị Node ≥ 20; đã test trên Node 24).
- SDK: [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/server) + Zod.
- Hoạt động với cả Rocket.Chat self-hosted lẫn Cloud, miễn là REST API truy cập được.

## Năm MCP tools

| Tool                         | Mục đích                                          | Side effect           |
| ---------------------------- | ------------------------------------------------- | --------------------- |
| `rocketchat_test_connection` | Xác thực URL/credential, trả identity của bot     | Không                 |
| `rocketchat_search_users`    | Tìm user qua `users.autocomplete`                 | Không                 |
| `rocketchat_list_rooms`      | Liệt kê room bot đã tham gia (đã lọc policy)      | Không                 |
| `rocketchat_preview_message` | Render preview dễ đọc trước màn xác nhận          | Không                 |
| `rocketchat_send_message`    | Gửi 1 message tới 1 đích (mention/thread/dry-run) | Có khi `dryRun=false` |

Chi tiết schema và ví dụ: [`docs/tool-reference.md`](docs/tool-reference.md).

## Cài đặt & thiết lập nhanh (khuyến nghị)

```bash
# Wizard hiện đại: cài runtime ổn định + tạo profile an toàn
npm create rocketchat-mcp@latest
```

Initializer sẽ:

1. Phát hiện và cho chọn nhiều MCP client: **Codex**, **Claude Code**, **Claude Desktop**.
2. Kiểm tra credential, phát hiện các room bot đã join và cho chọn allowlist hoặc
   **All joined rooms** với giải thích phạm vi rõ ràng.
3. Cấu hình DM, `@here`/`@all`, nơi lưu credential và vị trí cài runtime.
4. Cài runtime vào thư mục user ổn định, lưu token trong profile ENV mode
   `0600`, backup cấu hình cũ và rollback nếu ghi lỗi.
5. Hỗ trợ nhiều workspace qua các profile độc lập như `rocketchat-facon`.

`ROCKETCHAT_WORKSPACE_NAME` là biến **tùy chọn** cho tên gọi thân thiện của
workspace (vd `Facon`). Server dùng tên này trong MCP instructions và mô tả cả
năm tools để agent hiểu các câu như “gửi Facon đến #engineering”. Nếu không set,
server tự dùng hostname của `ROCKETCHAT_BASE_URL`. Initializer cho phép đặt tên này
ngay trong wizard.

Sau đó khởi động lại agent: Claude Desktop mở lại app; Claude Code gõ `/mcp`; Codex
chạy `codex mcp list`.

> `npm create rocketchat-mcp` chỉ chạy initializer từ cache tạm. Initializer luôn cài
> runtime vào vị trí bền vững trước khi ghi cấu hình, nên MCP không phụ thuộc cache
> `_npx`.

## Cấu hình

Sao chép `.env.example` thành `.env` và điền giá trị. Bắt buộc:

```env
ROCKETCHAT_BASE_URL=https://chat.example.com
ROCKETCHAT_USER_ID=bot-user-id
ROCKETCHAT_AUTH_TOKEN=personal-access-token
ROCKETCHAT_ALLOWED_ROOMS=general,engineering
```

**Thứ tự ưu tiên cấu hình:** biến môi trường **hệ thống luôn thắng**; file `.env`
(`<cwd>/.env` hoặc đường dẫn trong `ROCKETCHAT_ENV_FILE`) chỉ là _fallback_ cho các
key chưa được set. Vì vậy có thể dùng env hệ thống hoặc `ROCKETCHAT_ENV_FILE` mà
không cần cờ `--env-file`; `.env` không thể ghi đè secret set từ hệ thống.

Xem đầy đủ biến môi trường và quy tắc ở [`docs/configuration.md`](docs/configuration.md).
Ngữ nghĩa allowlist: **để trống = cho phép tất cả, có liệt kê = chỉ giới hạn trong
danh sách** — áp dụng cho cả room (`ROCKETCHAT_ALLOWED_ROOMS`) và DM
(`ROCKETCHAT_ALLOWED_DM_USERS`). ⚠️ **Default hiện tại nới lỏng** để dùng được ngay khi
chỉ có 3 secret: `ALLOW_DM`, `@here`, `@all` đều **bật** và mọi allowlist trống = cho
phép tất cả. Muốn theo least-privilege thì set `false` / liệt kê tường minh.

## Chạy server

```bash
# Dev (tsx, không cần build)
ROCKETCHAT_BASE_URL=... ROCKETCHAT_USER_ID=... ROCKETCHAT_AUTH_TOKEN=... \
ROCKETCHAT_ALLOWED_ROOMS=general npm run dev

# Production (sau khi build)
npm start
```

Log ứng dụng ở dạng JSON và **chỉ ghi ra stderr** để không phá vỡ giao thức MCP
trên stdout.

## Cấu hình cho Coding Agent (MCP client) — thủ công

`rocketchat-mcp-setup` đã tự làm phần này. Mục dưới đây chỉ cần khi bạn muốn cấu hình
**tay** hoặc tùy biến.

Ví dụ mục cấu hình MCP server (Claude Code / MCP client dạng stdio). Dùng đường dẫn
**tuyệt đối** tới `node` (GUI app / nvm thường không thấy `node` trong PATH), và trỏ
`ROCKETCHAT_ENV_FILE` tới `.env` để **không** phải nhét secret vào file cấu hình:

```json
{
  "mcpServers": {
    "rocketchat": {
      "command": "/duong-dan/tuyet-doi/toi/node",
      "args": ["/duong-dan/tuyet-doi/dist/index.js"],
      "env": {
        "ROCKETCHAT_ENV_FILE": "/duong-dan/tuyet-doi/.env"
      }
    }
  }
}
```

Cách khác: bỏ `ROCKETCHAT_ENV_FILE` và set thẳng các biến `ROCKETCHAT_*` trong khối
`env` (khi đó token nằm trong file cấu hình). Env trong khối `env` luôn ưu tiên hơn
`.env`.

Trước mỗi lần gửi, agent gọi `rocketchat_preview_message` để render đúng nội dung
sẽ gửi (gồm icon `🤖`, mentions và destination), hiển thị nguyên văn preview cho
người dùng, rồi mới gọi `rocketchat_send_message` với `dryRun=false` để MCP client
hiện màn xác nhận. Nếu người dùng chỉ yêu cầu xem trước thì workflow dừng sau tool
preview.

Wizard tự thêm permission cho ba tool read-only (`preview_message`, `search_users`,
`list_rooms`) trên Codex và Claude Code, nên các bước đọc/xem trước không cần
confirm. Tool gửi thật vẫn theo permission/approval policy của MCP client.

## Kiểm thử với MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

(Nhớ set các biến `ROCKETCHAT_*` trong môi trường trước khi chạy.)

## Dùng bản build local trong Codex

Tạo `.env` từ `.env.example`, điền credential test rồi chạy:

```bash
npm run mcp:local
```

Script build `dist/`, backup `~/.codex/config.toml` thành một file
`config.toml.bak.XXXXXX` riêng nếu config đã tồn tại, rồi dùng `codex mcp` để cấu
hình server `rocketchat` trỏ tới `dist/index.js` trong repo. Config Codex chỉ lưu
đường dẫn tuyệt đối của `.env`, không lưu token. Mở session Codex mới và dùng
`/mcp` để kiểm tra.

Các tùy chọn:

```bash
npm run mcp:local -- --dry-run
npm run mcp:local -- --name rocketchat-local
npm run mcp:local -- --env-file ./config/local.env
```

## Phát triển từ source

```bash
git clone <repo> && cd rocketchat-mcp-server
npm install         # cài deps (postinstall chỉ in gợi ý, không prompt)
npm run build       # biên dịch ra dist/
npm run setup       # chạy wizard từ source (tsx)

npm run typecheck   # kiểm tra kiểu (strict)
npm run lint        # ESLint
npm run format      # Prettier
npm test            # toàn bộ unit + contract + integration + e2e
```

## Xuất bản lên npm

```bash
npm login                 # đăng nhập tài khoản npm của bạn (chỉ cần khi chưa login)
npm run deploy:check      # chỉ kiểm tra, không đổi version và không publish
npm run deploy:current    # publish version hiện tại (dùng cho lần publish đầu tiên)
npm run deploy:patch      # sửa lỗi: 1.0.0 -> 1.0.1 rồi publish
npm run deploy:minor      # tính năng mới tương thích: 1.0.0 -> 1.1.0 rồi publish
npm run deploy:major      # breaking change: 1.0.0 -> 2.0.0 rồi publish
```

Deploy script kiểm tra, build và pack cả `rocketchat-mcp-server` lẫn
`create-rocketchat-mcp`. Khi publish, script luôn publish runtime trước rồi mới
publish initializer. Version runtime tương thích trong
`rocketchatMcp.runtimeVersion` được đồng bộ tự động ở các mode
`patch`/`minor`/`major`.

Ngay trước khi publish thật, script chạy `npm publish --dry-run` cho cả hai package.
Nếu một version đã tồn tại trên registry, script bỏ qua version đó; nhờ vậy có thể
chạy lại `deploy:current` khi runtime đã publish nhưng initializer chưa publish.
Trong CI tin cậy có thể bỏ xác nhận, ví dụ `npm run deploy:patch -- --yes`.
Nếu đang ở Git repository, hãy commit hết thay đổi trước; sau khi publish version mới,
script sẽ nhắc lệnh push release commit/tag.

Có thể kiểm tra riêng package initializer mà không publish:

```bash
npm run build:initializer
npm run pack:initializer
```

Sau khi deploy script publish thành công cả hai package, người dùng có thể chạy
`npm create rocketchat-mcp@latest`.

Lưu ý trước khi publish:

- Với package **scoped** lần đầu, publish public: `npm publish --access public`.
- `files` chỉ đóng gói `dist` + `postinstall.mjs`; `.env` và secret **không bao giờ**
  được đưa vào tarball.

Các suite `contract`, `integration`, `e2e` dùng một **mock Rocket.Chat server**
in-process (xem `test/fixtures/mock-rocketchat-server.ts`) nên chạy được mà không
cần workspace thật. Suite `e2e` spawn chính server này qua `stdio` bằng MCP client.

## Cấu trúc source

```
src/
  index.ts               # entry point (stdio + graceful shutdown)
  container.ts           # composition root (wire services)
  config/                # env schema + loader (fail-fast, HTTPS policy)
  observability/         # logger (stderr JSON) + redaction
  rocketchat/            # typed REST client, errors, rate-limit, endpoints
  policies/              # destination / mention / content policies
  services/              # connection, user, room, target-resolver, idempotency, message
  server/                # createServer + tool annotations
  tools/                 # 4 MCP tools + result/audit helpers
  setup/                 # wizard: chọn agent, nhập ENV, ghi config (cli/prompt/agents/writers/apply)
```

## Tài liệu

- [`docs/configuration.md`](docs/configuration.md) — biến môi trường & quy tắc.
- [`docs/security.md`](docs/security.md) — mô hình bảo mật, least-privilege, E2EE, idempotency.
- [`docs/tool-reference.md`](docs/tool-reference.md) — schema input/output & error codes.

## Ngoài phạm vi MVP

E2EE room, realtime WebSocket, multi-tenant remote, OAuth theo user, gửi nhiều
room cùng lúc, mạo danh (`alias`/`avatar`), tạo/sửa/xóa room-message, upload file,
đọc history — xem Phase 5 trong plan.
