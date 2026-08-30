# AGENT_MEMORYs

## 2026-08-27 — Xây dựng bot Telegram dịch Trung–Việt

### Mục tiêu
- Xây dựng bot Node.js dịch realtime hai chiều giữa tiếng Việt và tiếng Trung.
- Dùng nhà cung cấp chính thức, có kiểm soát quota, lỗi và quyền truy cập để chạy production an toàn.

### Đã thực hiện
- Khởi tạo dự án Node.js ESM với grammY runner và Google Cloud Translation Advanced v3.
- Nhận diện ngôn ngữ trước, chỉ chấp nhận `vi` hoặc họ `zh`, sau đó dịch với source/target rõ ràng; hỗ trợ đầu ra `zh-CN` và `zh-TW`.
- Thêm `/start`, `/help`, `/id`, reply theo tin gốc, chia output dài, queue tuần tự theo chat và xử lý song song giữa các chat.
- Thêm allowlist/fail-closed mặc định, chế độ public phải bật rõ ràng, rate limit theo chat/toàn bot và hard cap concurrency có hàng đợi giới hạn.
- Thêm timeout, retry hữu hạn, log đã che token, startup xóa webhook nhưng giữ pending update, graceful shutdown và đóng Google client.
- Viết README, `.env.example`, `.gitignore`, ESLint và test cho config, dịch, bot, rate limit, queue, semaphore, startup và shutdown.

### Quyết định kỹ thuật
- Dùng `@google-cloud/translate` v3 với Application Default Credentials; không dùng endpoint Google Translate web hoặc package scrape không chính thức.
- Chọn luồng `detectLanguage` → `translateText` để từ chối ngôn ngữ ngoài phạm vi và tránh đoán target mù.
- Mặc định không dịch cho bất kỳ chat nào cho đến khi có allowlist hoặc `TELEGRAM_ALLOW_ALL_CHATS=true`, nhằm tránh người lạ đốt billing.
- Long polling chạy một instance; runner sink nhận tối đa batch Telegram nhưng semaphore mới là hard cap tác vụ Google.
- Giữ primary runtime error riêng với cleanup error; nếu dừng runner và đóng Google client cùng lỗi thì dùng `AggregateError`.

### Kiểm tra
- `npm.cmd run check`: ESLint và 42/42 test pass.
- Node.js `v22.13.1`: ESLint và toàn bộ test pass.
- `npm.cmd audit --omit=dev`: 0 vulnerability; dependency tree hợp lệ.
- Tất cả file dự án đọc được bằng UTF-8 strict; không phát hiện mojibake. Ký tự `U+FFFD` duy nhất là assertion có chủ đích trong test splitter.
- Secret scan không phát hiện credential thật; ba chuỗi giống Telegram token đều là fixture giả trong test.
- Startup không có `.env` fail-fast đúng tại `TELEGRAM_BOT_TOKEN` và không gọi mạng.

### Việc còn lại
- Chưa smoke test live vì workspace không có Telegram token, Google project hoặc ADC; cần cấu hình `.env`, credential rồi gửi thử tin Việt/Trung thật.
- `@grammyjs/runner` 2.0.3 chờ `retry_after` của `getUpdates` mà không abort-aware; watchdog 130 giây giới hạn shutdown nhưng deployment có grace period ngắn hơn cần lưu ý.
- Orchestration `src/index.js` mới được kiểm tra qua helper và negative startup, chưa có integration test dependency-injected toàn luồng.

## 2026-08-27 — Xuất bản repository GitHub

### Mục tiêu
- Đưa toàn bộ mã nguồn Trans-Bot lên repository `m008v/Telegram-Bot-Trans` trên branch `main`.

### Đã thực hiện
- Khởi tạo Git repository, đặt branch mặc định là `main` và cấu hình remote `origin` bằng HTTPS.
- Xuất bản toàn bộ source, test, lockfile, tài liệu và agent memory; giữ `.env` cùng `node_modules` ngoài Git.
- Giữ README hiện có thay vì append thêm tiêu đề trùng lặp từ hướng dẫn repository rỗng của GitHub.

### Quyết định kỹ thuật
- Commit đầu tiên dùng Conventional Commit có scope, không dùng message chung chung `first commit`.
- Chỉ `.env.example` được theo dõi; credential thật phải tiếp tục nằm ngoài repository.

### Kiểm tra
- `npm.cmd run check`: ESLint và 42/42 test pass ngay trước khi commit.
- `npm.cmd audit --omit=dev --audit-level=moderate`: 0 vulnerability.
- Secret scan chỉ tìm thấy ba Telegram token fixture giả trong test.
- UTF-8 strict pass; không phát hiện mojibake ngoài assertion `U+FFFD` có chủ đích.

### Việc còn lại
- Vẫn cần credential thật để smoke test Telegram và Google Cloud Translation trên môi trường chạy.

## 2026-08-27 — Chuyển sang endpoint Google GTX không cần API key

### Mục tiêu
- Thay Google Cloud Translation có billing/ADC bằng endpoint GTX do người dùng chỉ định, giữ luồng dịch Trung–Việt và các giới hạn vận hành hiện có.

### Đã thực hiện
- Thay `GoogleTranslateService` bằng `GtxTranslateService` dùng native `fetch` và `POST application/x-www-form-urlencoded` tới URL hard-code `translate.googleapis.com/translate_a/single`.
- Gỡ `@google-cloud/translate` cùng toàn bộ cấu hình project, location, credential và confidence; cập nhật lockfile, `.env.example` và README.
- Dùng Unicode script để chọn chiều dịch. Tiếng Việt rõ ràng dùng `sl=vi`; câu Latin mơ hồ dùng `sl=auto` và chỉ được chấp nhận khi response báo nguồn `vi`; tiếng Trung dùng `sl=zh` để tránh auto-detect sai phồn thể.
- Thêm parser GTX chặt chẽ, timeout, chặn redirect, kiểm tra status/content type/schema, giới hạn body 256 KB khi đọc stream và không đưa nội dung dịch lên query string hoặc log.
- Thêm test cho Trung giản thể/phồn thể, Việt có dấu/không dấu, câu Latin mơ hồ, từ chối tiếng Anh/Nhật, multi-segment, timeout/network/HTTP, response hỏng và stream quá lớn.

### Quyết định kỹ thuật
- Không dùng `tl=cn` vì endpoint âm thầm fallback sang tiếng Anh; chỉ cho phép `vi`, `zh-CN` và `zh-TW` theo chiều dịch.
- Không tin hoàn toàn `sl=auto`: probe thực tế nhận sai tiếng Việt không dấu và tiếng Trung phồn thể. Kết hợp dấu hiệu tiếng Việt cục bộ với auto-detect cho input Latin mơ hồ để giảm cả false reject lẫn dịch nhầm tiếng Anh.
- Endpoint GTX là giao diện nội bộ, không có SLA/quota cam kết và bị `robots.txt` chặn; README cảnh báo rõ, production ổn định vẫn nên dùng API chính thức.

### Kiểm tra
- `npm.cmd ci`: cài sạch 80 package, audit tại bước cài đặt báo 0 vulnerability.
- `npm.cmd run check` trên Node.js `v24.13.0`: ESLint và 58/58 test pass.
- Node.js `v22.13.1`: ESLint và 58/58 test pass.
- Probe POST trực tiếp ban đầu dịch được cả Việt → Trung và Trung → Việt; smoke bằng service hoàn chỉnh sau đó bị Google trả redirect chống bot, được chặn và phân loại thành lỗi provider thay vì parse HTML.

### Việc còn lại
- Endpoint hiện có thể chặn theo IP/tần suất; không được coi unit test xanh là bằng chứng dịch vụ ngoài đang sẵn sàng.
- Chưa smoke test Telegram end-to-end vì `.env` không có token; cần điền `TELEGRAM_BOT_TOKEN` và allowlist rồi chạy bot.
- Heuristic có thể từ chối câu tiếng Việt quá ngắn/không dấu hoặc câu trộn ngôn ngữ khó phân biệt; đây là trade-off để giữ phạm vi chỉ Trung–Việt khi dùng provider không chính thức.

## 2026-08-29 — Nhận diện từ tiếng Việt cực ngắn

### Mục tiêu
- Sửa lỗi từ/cảm thán tiếng Việt rất ngắn như `ê` bị gửi với `sl=auto` rồi bị Google nhận sai ngôn ngữ.

### Đã thực hiện
- Bổ sung nhận diện các chữ `ă`, `đ`, `ơ`, `ư` và ngoại lệ một từ `ê`, `cô`, `hãy` làm bằng chứng tiếng Việt trước khi gọi provider.
- Thêm regression test xác nhận `ê`, `ơi`, `đi`, `ăn`, `cô`, `hãy` được nhận là tiếng Việt và request dùng `sl=vi`.
- Giữ test chống nhận nhầm tiếng Anh, Pháp và Bồ Đào Nha như `Hello world`, `être`, `Hôtel`, `não`, `avô`.

### Quyết định kỹ thuật
- Chỉ mở các dấu hiệu/ngoại lệ hẹp thay vì coi mọi token Latin ngắn là tiếng Việt; cách sau sẽ nhận nhầm các từ như `hi`, `go`, `no`.
- Với chuỗi `ê` đứng riêng, không thể phân biệt ngôn ngữ chỉ từ Unicode; bot chủ động ưu tiên ngữ cảnh Việt–Trung theo yêu cầu sản phẩm.

### Kiểm tra
- `npm.cmd run check`: ESLint và 59/59 test pass.
- Live smoke qua `GtxTranslateService`: `ê` dùng source `vi`, target `zh-CN` và nhận bản dịch `你好`.

### Việc còn lại
- Cần restart/redeploy tiến trình bot đang chạy để nạp commit mới.
- `AGENT_MEMORYs copy.md` là bản copy ngoài Git có sẵn trước task; giữ nguyên và không stage.

## 2026-08-30 — Gửi bản dịch như tin nhắn thường

### Mục tiêu
- Bỏ giao diện reply/quote tin nhắn gốc; bản dịch và thông báo của bot phải xuất hiện như tin nhắn mới trong chat.

### Đã thực hiện
- Xóa toàn bộ `reply_parameters` khỏi bản dịch, các chunk dài, lỗi dịch và cảnh báo rate-limit.
- Cập nhật nội dung `/start` để mô tả đúng hành vi gửi bản dịch thành tin nhắn mới.
- Thêm regression test xác nhận mọi nhánh trên gọi Telegram mà không truyền reply options.

### Quyết định kỹ thuật
- Tiếp tục dùng `ctx.reply()` của grammY vì đây là helper gửi `sendMessage`; chỉ `reply_parameters` mới tạo UI reply vào một message cụ thể.
- Không thay đổi queue, rate limit, chia chunk hoặc retry Telegram để giữ nguyên hành vi ngoài phạm vi giao diện.

### Kiểm tra
- `npm.cmd run check`: ESLint và 60/60 test pass.
- Node.js `v22.13.1`: ESLint và 60/60 test pass.
- `npm.cmd audit --omit=dev --audit-level=moderate`: 0 vulnerability.

### Việc còn lại
- Cần restart/redeploy tiến trình bot đang chạy để nạp commit mới.
- `AGENT_MEMORYs copy.md` ngoài Git tiếp tục được giữ nguyên và không stage.

## 2026-08-30 — Cho phép admin tự thêm group vào allowlist

### Mục tiêu
- Cho phép cấu hình Telegram user ID của admin trong `.env`; admin dùng `/addchat` trong group để thêm chat đó vào `TELEGRAM_ALLOWED_CHAT_IDS`.

### Đã thực hiện
- Thêm `TELEGRAM_ADMIN_IDS`, validate danh sách user ID dương và truyền quyền admin vào bot.
- Thêm `/addchat` cho group/supergroup; người không có quyền bị bỏ qua, chế độ public bị từ chối và lỗi ghi file chỉ trả thông báo an toàn.
- Thêm `AllowedChatStore` cập nhật `.env` theo kiểu atomic, ghi tuần tự để tránh mất update đồng thời, giữ cấu hình/comment khác và cập nhật `Set` trong RAM sau khi ghi thành công.
- Đăng ký command với Telegram, cập nhật `.env.example`, README và regression test cho config, authorization, persistence, concurrency và UTF-8 lỗi.

### Quyết định kỹ thuật
- So sánh Telegram ID dưới dạng chuỗi để không phụ thuộc giới hạn safe integer của JavaScript.
- Chỉ mở quyền trong RAM sau khi rename `.env` thành công; nếu ghi lỗi thì fail-closed và không làm group được phép tạm thời.
- Không cho `/addchat` chạy khi `TELEGRAM_ALLOW_ALL_CHATS=true` vì cấu hình public và allowlist loại trừ nhau.
- File tạm nằm cùng thư mục để rename atomic, dùng mode `0600` khi tạo mới và tên `.env.*.tmp` tiếp tục được `.gitignore` che nếu tiến trình chết giữa lúc ghi.

### Kiểm tra
- `npm.cmd run check`: ESLint và 69/69 test pass trên Node.js `v24.13.0`.
- `npm.cmd audit --omit=dev --audit-level=moderate`: 0 vulnerability.
- Test persistence thật trên file tạm Windows pass, gồm hai update đồng thời, duplicate, không để file tạm và từ chối `.env` sai UTF-8 mà không mở quyền trong RAM.
- Lần thử chạy Node.js `v22.13.1` chưa bắt đầu được vì cache `npx` lỗi `ENOENT`; đây là lỗi tooling, không phải test fail.

### Việc còn lại
- Điền Telegram user ID thật vào `TELEGRAM_ADMIN_IDS` trong `.env` rồi restart bot để nạp quyền admin; không có ID thật nào được commit.
- Chưa smoke test với Telegram thật vì không sử dụng token trong `.env` ở task này.
- `AGENT_MEMORYs copy.md` ngoài Git tiếp tục được giữ nguyên và không stage.

## 2026-08-30 — Thu hồi và liệt kê allowlist bằng command

### Mục tiêu
- Thêm `/unchat` để admin xoá group hiện tại khỏi allowlist và `/list` để xem các chat/group đang được phép dùng bot.

### Đã thực hiện
- Mở rộng `AllowedChatStore` với thao tác remove dùng chung hàng đợi ghi tuần tự và atomic update `.env`; chỉ cập nhật `Set` trong RAM sau khi persistence thành công.
- Thêm `/unchat` chỉ dùng trong group/supergroup và `/list` dùng được từ chat chưa nằm trong allowlist; cả hai chỉ chấp nhận Telegram user ID thuộc `TELEGRAM_ADMIN_IDS`.
- `/list` hiển thị ID dạng plain text, báo rõ allowlist rỗng/public mode và chia danh sách dài dưới giới hạn Telegram.
- Đăng ký hai command với Telegram, cập nhật README và thêm regression test cho quyền, persistence, lỗi ghi file, danh sách dài và áp dụng thu hồi ngay.

### Quyết định kỹ thuật
- Giữ danh sách theo ID đang áp dụng trong RAM thay vì gọi `getChat` cho từng entry; lệnh không phụ thuộc network hoặc trạng thái bot còn là thành viên group.
- Cho phép các lệnh quản trị đi qua middleware ở chat chưa được phép nhưng kiểm tra admin ở cả middleware lẫn handler; người không có quyền bị bỏ qua im lặng.
- Khi xoá, giữ nguyên secret, comment, newline và các ID khác trong `.env`; cấu hình sai UTF-8 hoặc ghi lỗi không làm RAM lệch khỏi file đã persist.

### Kiểm tra
- `npm.cmd run check`: ESLint và 76/76 test pass trên Node.js `v24.13.0`.
- `npm.cmd audit --omit=dev --audit-level=moderate`: 0 vulnerability.
- `git diff --check`, secret pattern scan và strict UTF-8/mojibake scan trên toàn bộ file thay đổi đều pass.

### Việc còn lại
- Chưa smoke test Telegram thật để tránh dùng token hoặc thay đổi command menu của bot đang chạy trong lượt kiểm tra local.
- Cần restart/redeploy bot để nạp command mới; startup tiếp theo sẽ đồng bộ menu qua `setMyCommands`.
- `.env.example`, `AGENT_MEMORYs copy.md` và `src.zip` là thay đổi/file có sẵn trước task; không stage vào commit này.

## 2026-08-30 — Hiển thị tên chat trong `/list`

### Mục tiêu
- Sửa `/list` để hiển thị tên nhóm/chat cùng ID thay vì chỉ có ID khó nhận biết.

### Đã thực hiện
- Resolve metadata hiện tại của từng allowlist entry bằng Telegram `getChat`, hỗ trợ title của group/channel và họ tên hoặc username của private chat.
- Giới hạn bốn lookup song song và dùng chung timeout 10 giây; một lookup lỗi chỉ fallback `Không lấy được tên` cho đúng ID đó.
- Chuẩn hoá whitespace, loại ký tự bidi điều khiển và giới hạn độ dài tên trước khi ghép plain text vào danh sách.
- Cập nhật README và test cho tên group/private, thứ tự kết quả, fallback lỗi, che token, concurrency cap và danh sách dài.

### Quyết định kỹ thuật
- Yêu cầu hiển thị tên thay thế quyết định chỉ liệt kê ID của task trước; không persist tên vào `.env` để tránh dữ liệu nhanh lỗi thời và format cấu hình phình thêm.
- Không log tên chat; log lookup lỗi chỉ chứa chat ID và error đã qua `toSafeError` với bot token được redaction.

### Kiểm tra
- `npm.cmd run check`: ESLint và 77/77 test pass trên Node.js `v24.13.0`.
- `npm.cmd audit --omit=dev --audit-level=moderate`: 0 vulnerability.
- `git diff --check` và strict UTF-8/mojibake scan pass; secret scan chỉ khớp Telegram token fixture có chủ đích trong regression test redaction.

### Việc còn lại
- Chưa smoke test `getChat` với Telegram thật; bot đang chạy cần restart/redeploy để nạp thay đổi.
- `.env.example`, `AGENT_MEMORYs copy.md` và `src.zip` tiếp tục được giữ nguyên ngoài commit task.

## 2026-08-30 — Im lặng với ngôn ngữ không hỗ trợ

### Mục tiêu
- Loại bỏ tin nhắn cảnh báo khi bot phát hiện nội dung ngoài tiếng Trung hoặc tiếng Việt.

### Đã thực hiện
- Cho `UnsupportedLanguageError` kết thúc handler mà không gửi tin nhắn vào chat và không ghi log lỗi provider.
- Giữ nguyên thông báo cho input vô nghĩa, quá tải và lỗi Google GTX để lỗi vận hành thật không bị che.
- Cập nhật README và regression test cho hành vi bỏ qua im lặng.

### Quyết định kỹ thuật
- Chỉ bỏ phản hồi của nhánh ngôn ngữ không hỗ trợ; không nuốt mọi exception vì như vậy sẽ biến lỗi API thành lỗi câm, loại drama khó debug nhất.

### Kiểm tra
- `npm.cmd run check`: ESLint và 77/77 test pass trên Node.js `v24.13.0`.
- `git diff --check` pass.

### Việc còn lại
- Cần restart/redeploy tiến trình bot để nạp hành vi mới.
- `.env.example` và `AGENT_MEMORYs copy.md` là thay đổi/file có sẵn trước task; không stage vào commit này.
