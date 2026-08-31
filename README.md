# Trans-Bot

Bot Telegram dịch hai chiều theo thời gian thực:

- Tin nhắn tiếng Việt → tiếng Trung (`zh`).
- Tin nhắn tiếng Trung → tiếng Việt.
- Gọi Yandex Translate API v2 chính thức bằng `POST` JSON.
- Giữ thứ tự tin nhắn trong từng chat nhưng vẫn xử lý song song giữa các chat.
- Tự chia bản dịch dài để không vượt giới hạn tin nhắn Telegram.
- Mặc định fail-closed, có allowlist, rate limit và giới hạn số tác vụ dịch chạy đồng thời.

> [!IMPORTANT]
> Yandex Translate cần billing account ở trạng thái `ACTIVE` hoặc `TRIAL_ACTIVE`, service account có role `ai.translate.user` và API key có scope `yc.ai.translate.execute`. Quota mặc định hiện tại là 20 request/giây và 1 triệu ký tự/giờ; đây là quota kỹ thuật, không đồng nghĩa miễn phí.

## Yêu cầu

- Node.js `>= 22.13.0`.
- Một bot tạo bởi [@BotFather](https://t.me/BotFather).
- Một service account Yandex với API key dành cho Translate.

## Cài đặt

```powershell
Copy-Item .env.example .env
npm.cmd ci
```

Sửa `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=123456789:token_thật_từ_BotFather
YANDEX_TRANSLATE_API_KEY=api_key_thật_từ_Yandex
YANDEX_TRANSLATE_FOLDER_ID=
CHINESE_TARGET_LANGUAGE=zh
TELEGRAM_ALLOWED_CHAT_IDS=123456789,-1001234567890
TELEGRAM_ALLOW_ALL_CHATS=false
TELEGRAM_ADMIN_IDS=123456789
```

Chạy bot:

```powershell
npm.cmd start
```

Chế độ phát triển tự khởi động lại khi file thay đổi:

```powershell
npm.cmd run dev
```

## Cấu hình

| Biến | Bắt buộc | Mặc định | Ý nghĩa |
|---|---:|---|---|
| `TELEGRAM_BOT_TOKEN` | Có | — | Token bí mật từ BotFather. |
| `YANDEX_TRANSLATE_API_KEY` | Có | — | API key của service account Yandex; không commit hoặc ghi vào log. |
| `YANDEX_TRANSLATE_FOLDER_ID` | Không | Rỗng | Folder ID nếu kiểu xác thực/tài khoản yêu cầu; bỏ trống với service account không cần trường này. |
| `CHINESE_TARGET_LANGUAGE` | Không | `zh` | Yandex chỉ công bố mã `zh`; `zh-CN` được nhận như alias tương thích cấu hình cũ. `zh-TW` không được hỗ trợ. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Không | Rỗng | Danh sách chat ID, phân cách bằng dấu phẩy. |
| `TELEGRAM_ALLOW_ALL_CHATS` | Không | `false` | Phải đặt `true` rõ ràng nếu muốn bot public. Không dùng cùng allowlist. |
| `TELEGRAM_ADMIN_IDS` | Không | Rỗng | Danh sách Telegram user ID được quản lý allowlist bằng `/addchat`, `/unchat` và `/list`, phân cách bằng dấu phẩy. |
| `TELEGRAM_MAX_TRANSLATIONS_PER_MINUTE` | Không | `20` | Số tin dịch tối đa mỗi chat trong một phút. |
| `TELEGRAM_GLOBAL_MAX_TRANSLATIONS_PER_MINUTE` | Không | `120` | Số tin dịch tối đa toàn bot trong một phút. |
| `MAX_CONCURRENT_TRANSLATIONS` | Không | `8` | Hard cap số tác vụ dịch chạy song song; hàng đợi chờ tối đa gấp đôi giá trị này. |
| `TRANSLATION_TIMEOUT_MS` | Không | `15000` | Timeout mỗi request, từ 1.000 đến 60.000 ms. |

Dùng `/id` để lấy chat ID cần đưa vào allowlist. Riêng `/id` và các lệnh quản trị allowlist từ admin được phép với rate limit thấp để bootstrap cấu hình. Nếu allowlist rỗng và `TELEGRAM_ALLOW_ALL_CHATS` không phải `true`, bot không dịch tin nhắn nào.

Để admin quản lý group, điền Telegram user ID của admin vào `TELEGRAM_ADMIN_IDS` rồi dùng:

- `/addchat` trong group để thêm group hiện tại.
- `/unchat` trong group để xoá group hiện tại.
- `/list` trong bất kỳ chat nào để xem tên và ID của các chat/group đang được phép.

Bot chỉ chấp nhận ba lệnh trên từ đúng user ID đã cấu hình, cập nhật `.env` theo kiểu atomic và áp dụng thay đổi ngay không cần restart. `/list` lấy tên hiện tại bằng Telegram `getChat`; nếu bot không còn truy cập được một chat, dòng đó vẫn giữ ID và hiển thị `Không lấy được tên`. Nếu chưa biết user ID, nhắn riêng `/id` cho bot; trong private chat, Chat ID chính là user ID. Các lệnh quản trị allowlist không dùng được khi `TELEGRAM_ALLOW_ALL_CHATS=true` vì chế độ public và allowlist loại trừ nhau.

## Cách xác định chiều dịch

Bot kết hợp kiểm tra Unicode cục bộ với auto-detect của Yandex để không giao toàn bộ quyết định ngôn ngữ cho provider:

- Chữ Hán chiếm ưu thế: gửi source `zh` và dịch sang tiếng Việt.
- Chữ Latin có dấu hiệu tiếng Việt rõ ràng: gửi source `vi` và dịch sang `zh`.
- Câu Latin còn mơ hồ: bỏ source để Yandex tự nhận diện; chỉ chấp nhận bản dịch khi response báo nguồn là `vi`.
- Nếu số chữ Hán và Latin bằng nhau nhưng có chữ Hán: ưu tiên tiếng Trung.
- Tin chỉ có emoji, số, dấu câu hoặc chứa chữ Nhật/Hàn bị từ chối trước khi gọi Yandex.

Đây vẫn là heuristic. Tin quá ngắn, tiếng Việt không dấu hiếm gặp hoặc câu trộn nhiều ngôn ngữ có thể bị từ chối để tránh dịch nhầm tiếng Anh sang Trung.

## Dùng trong group

Telegram mặc định bật privacy mode, khiến bot trong group không nhận mọi tin nhắn thường. Nếu muốn bot dịch tất cả tin nhắn trong group:

1. Mở BotFather → `/setprivacy`.
2. Chọn bot → `Disable`.
3. Xóa bot khỏi group rồi thêm lại nếu Telegram chưa áp dụng thay đổi.

Bot bỏ qua tin nhắn của bot khác, command, nội dung không có chữ hợp lệ và ngôn ngữ ngoài tiếng Trung/Việt để tránh loop hoặc làm loãng cuộc trò chuyện. Bản dịch được gửi dạng plain text, không render HTML từ nội dung người dùng. Với group đông, nên giữ privacy mode và yêu cầu thành viên nhắn riêng cho bot.

## Kiểm tra

```powershell
npm.cmd run check
```

Lệnh này chạy ESLint và toàn bộ unit test bằng test runner tích hợp của Node.js. Unit test dùng HTTP giả lập, không gọi hoặc đốt quota Yandex.

## Lưu ý vận hành và bảo mật

- Nội dung dịch được đặt trong body JSON của request `POST`, không xuất hiện trên query string; nội dung vẫn được gửi tới Yandex để xử lý.
- URL dịch được hard-code, không nhận từ biến môi trường hay input người dùng để tránh biến tính năng này thành SSRF.
- Bot không lưu hoặc log nội dung tin nhắn hay response thô. Log lỗi chỉ chứa metadata cần thiết.
- Request đặt `x-data-logging-enabled: false`; theo tài liệu Yandex, dữ liệu request mặc định cũng không được lưu nếu không bật header này.
- Response từ Yandex được giới hạn kích thước và kiểm tra chặt content type, HTTP status và cấu trúc JSON trước khi dùng.
- `401`, `403`, `429`, timeout, network failure và response sai cấu trúc được phân loại thành lỗi nhà cung cấp; bot không tự retry request dịch để tránh tính phí/quota lặp cho kết quả không chắc chắn.
- Lỗi API Telegram như `429`/server error được retry tối đa ba lần khi thời gian chờ không vượt 10 giây. Lỗi mạng mơ hồ không tự retry `sendMessage` để giảm nguy cơ gửi bản dịch trùng.
- Khi khởi động, bot xóa webhook nhưng giữ nguyên update đang chờ rồi mới chạy long polling. Mỗi token chỉ nên chạy một instance tại một thời điểm.

Tham khảo: [Telegram Bot API](https://core.telegram.org/bots/api), [Yandex Translate REST API](https://aistudio.yandex.ru/en/docs/translate/api-ref/Translation/translate), [xác thực Yandex Translate](https://aistudio.yandex.ru/en/docs/translate/api-ref/authentication), [quota Yandex Translate](https://aistudio.yandex.ru/en/docs/translate/concepts/limits).
