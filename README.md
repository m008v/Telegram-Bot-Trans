# Trans-Bot

Bot Telegram dịch hai chiều theo thời gian thực:

- Tin nhắn tiếng Việt → tiếng Trung (`zh-CN` mặc định, có thể đổi sang `zh-TW`).
- Tin nhắn tiếng Trung → tiếng Việt.
- Gọi endpoint Google GTX bằng `POST`, không cần Google Cloud project, API key hay billing.
- Giữ thứ tự tin nhắn trong từng chat nhưng vẫn xử lý song song giữa các chat.
- Tự chia bản dịch dài để không vượt giới hạn tin nhắn Telegram.
- Mặc định fail-closed, có allowlist, rate limit và giới hạn số tác vụ dịch chạy đồng thời.

> [!WARNING]
> Google GTX là endpoint nội bộ, không có tài liệu công khai, SLA hoặc quota cam kết. Google có thể đổi giao thức, giới hạn hay chặn request bất kỳ lúc nào; `robots.txt` của dịch vụ cũng chặn đường dẫn `/translate_a/`. Dùng Cloud Translation API chính thức nếu cần vận hành production ổn định hoặc tuân thủ điều khoản chặt chẽ.

## Yêu cầu

- Node.js `>= 22.13.0`.
- Một bot tạo bởi [@BotFather](https://t.me/BotFather).

## Cài đặt

```powershell
Copy-Item .env.example .env
npm.cmd ci
```

Sửa `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=123456789:token_thật_từ_BotFather
CHINESE_TARGET_LANGUAGE=zh-CN
TELEGRAM_ALLOWED_CHAT_IDS=123456789,-1001234567890
TELEGRAM_ALLOW_ALL_CHATS=false
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
| `CHINESE_TARGET_LANGUAGE` | Không | `zh-CN` | Chọn `zh-CN` hoặc `zh-TW`. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Không | Rỗng | Danh sách chat ID, phân cách bằng dấu phẩy. |
| `TELEGRAM_ALLOW_ALL_CHATS` | Không | `false` | Phải đặt `true` rõ ràng nếu muốn bot public. Không dùng cùng allowlist. |
| `TELEGRAM_MAX_TRANSLATIONS_PER_MINUTE` | Không | `20` | Số tin dịch tối đa mỗi chat trong một phút. |
| `TELEGRAM_GLOBAL_MAX_TRANSLATIONS_PER_MINUTE` | Không | `120` | Số tin dịch tối đa toàn bot trong một phút. |
| `MAX_CONCURRENT_TRANSLATIONS` | Không | `8` | Hard cap số tác vụ dịch chạy song song; hàng đợi chờ tối đa gấp đôi giá trị này. |
| `TRANSLATION_TIMEOUT_MS` | Không | `15000` | Timeout mỗi request, từ 1.000 đến 60.000 ms. |

Dùng `/id` để lấy chat ID cần đưa vào allowlist. Riêng lệnh này được phép với rate limit thấp để bootstrap cấu hình. Nếu allowlist rỗng và `TELEGRAM_ALLOW_ALL_CHATS` không phải `true`, bot chỉ nhận `/id` và không dịch tin nhắn nào.

## Cách xác định chiều dịch

Bot kết hợp kiểm tra Unicode cục bộ với `sl=auto`, vì để Google tự đoán mọi trường hợp thường nhận nhầm tiếng Việt không dấu và tiếng Trung phồn thể:

- Chữ Hán chiếm ưu thế: gửi `sl=zh` và dịch sang tiếng Việt.
- Chữ Latin có dấu hiệu tiếng Việt rõ ràng: gửi `sl=vi` và dịch sang `CHINESE_TARGET_LANGUAGE`.
- Câu Latin còn mơ hồ: gửi `sl=auto`; chỉ chấp nhận bản dịch khi Google báo ngôn ngữ nguồn là `vi`.
- Nếu số chữ Hán và Latin bằng nhau nhưng có chữ Hán: ưu tiên tiếng Trung.
- Tin chỉ có emoji, số, dấu câu hoặc chứa chữ Nhật/Hàn bị từ chối trước khi gọi Google.

Đây vẫn là heuristic vì endpoint miễn phí không cung cấp cam kết nhận diện. Tin quá ngắn, tiếng Việt không dấu hiếm gặp hoặc câu trộn nhiều ngôn ngữ có thể bị từ chối để tránh dịch nhầm tiếng Anh sang Trung.

## Dùng trong group

Telegram mặc định bật privacy mode, khiến bot trong group không nhận mọi tin nhắn thường. Nếu muốn bot dịch tất cả tin nhắn trong group:

1. Mở BotFather → `/setprivacy`.
2. Chọn bot → `Disable`.
3. Xóa bot khỏi group rồi thêm lại nếu Telegram chưa áp dụng thay đổi.

Bot bỏ qua tin nhắn của bot khác và command để tránh loop. Bản dịch được gửi dạng plain text, không render HTML từ nội dung người dùng. Với group đông, nên giữ privacy mode và yêu cầu thành viên nhắn riêng cho bot.

## Kiểm tra

```powershell
npm.cmd run check
```

Lệnh này chạy ESLint và toàn bộ unit test bằng test runner tích hợp của Node.js. Unit test dùng HTTP giả lập, không spam endpoint GTX.

## Lưu ý vận hành và bảo mật

- Nội dung dịch được đặt trong body form của request `POST`, không xuất hiện trên query string; tuy vậy nội dung vẫn được gửi tới Google.
- URL dịch được hard-code, không nhận từ biến môi trường hay input người dùng để tránh biến tính năng này thành SSRF.
- Bot không lưu hoặc log nội dung tin nhắn hay response thô. Log lỗi chỉ chứa metadata cần thiết.
- Response từ GTX được giới hạn kích thước và kiểm tra chặt content type, HTTP status và cấu trúc JSON trước khi dùng.
- Redirect, HTML chống bot, `403`, `429`, timeout và response sai cấu trúc được trả về dưới dạng lỗi nhà cung cấp; người dùng có thể thử lại sau.
- Lỗi API Telegram như `429`/server error được retry tối đa ba lần khi thời gian chờ không vượt 10 giây. Lỗi mạng mơ hồ không tự retry `sendMessage` để giảm nguy cơ gửi bản dịch trùng.
- Khi khởi động, bot xóa webhook nhưng giữ nguyên update đang chờ rồi mới chạy long polling. Mỗi token chỉ nên chạy một instance tại một thời điểm.

Tham khảo: [Telegram Bot API](https://core.telegram.org/bots/api), [Google Translate robots.txt](https://translate.googleapis.com/robots.txt), [Điều khoản dịch vụ Google](https://policies.google.com/terms?hl=vi).
