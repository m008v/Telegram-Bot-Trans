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
