# Trans-Bot

Bot Telegram dịch hai chiều theo thời gian thực:

- Tin nhắn tiếng Việt → tiếng Trung (`zh-CN` mặc định, có thể đổi sang `zh-TW`).
- Tin nhắn tiếng Trung → tiếng Việt.
- Dùng **Google Cloud Translation Advanced (v3)** chính thức; không gọi endpoint web lậu.
- Gọi API nhận diện trước, chỉ dịch khi Google xác định đúng tiếng Trung/Việt với độ tin cậy đủ cao.
- Giữ thứ tự tin nhắn trong từng chat, nhưng vẫn xử lý song song giữa các chat.
- Tự chia bản dịch dài để không vượt giới hạn tin nhắn Telegram.
- Mặc định fail-closed, có rate limit theo chat/toàn bot và hard-cap số tác vụ Google chạy đồng thời.

## Yêu cầu

- Node.js `>= 22.13.0`.
- Một bot tạo bởi [@BotFather](https://t.me/BotFather).
- Google Cloud project đã bật billing và [Cloud Translation API](https://cloud.google.com/translate/docs/setup).
- Application Default Credentials có quyền dùng Cloud Translation, khuyến nghị role `Cloud Translation API User` (`roles/cloudtranslate.user`).

## Cài đặt

```powershell
Copy-Item .env.example .env
npm.cmd install
```

Sửa `.env`:

```dotenv
TELEGRAM_BOT_TOKEN=123456789:token_thật_từ_BotFather
GOOGLE_CLOUD_PROJECT=your-google-cloud-project
GOOGLE_APPLICATION_CREDENTIALS=C:/secure/trans-bot-service-account.json
CHINESE_TARGET_LANGUAGE=zh-CN
TELEGRAM_ALLOWED_CHAT_IDS=123456789,-1001234567890
TELEGRAM_ALLOW_ALL_CHATS=false
```

Không đặt service-account JSON trong repository. Khi phát triển local, có thể bỏ biến `GOOGLE_APPLICATION_CREDENTIALS` và chạy `gcloud auth application-default login`. Khi chạy trên Google Cloud, hãy gán service account cho workload; client sẽ dùng [Application Default Credentials](https://cloud.google.com/docs/authentication/provide-credentials-adc).

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
| `GOOGLE_CLOUD_PROJECT` | Có | — | Project ID đã bật Cloud Translation API. |
| `GOOGLE_CLOUD_LOCATION` | Không | `global` | Location của Translation Advanced. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Khi chạy local | ADC | Đường dẫn tuyệt đối tới service-account JSON. |
| `CHINESE_TARGET_LANGUAGE` | Không | `zh-CN` | Chọn `zh-CN` hoặc `zh-TW`. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Không | Rỗng | Danh sách chat ID, phân cách bằng dấu phẩy. |
| `TELEGRAM_ALLOW_ALL_CHATS` | Không | `false` | Phải đặt `true` rõ ràng nếu muốn bot public. Không dùng cùng allowlist. |
| `TELEGRAM_MAX_TRANSLATIONS_PER_MINUTE` | Không | `20` | Số tin dịch tối đa mỗi chat trong một phút. |
| `TELEGRAM_GLOBAL_MAX_TRANSLATIONS_PER_MINUTE` | Không | `120` | Số tin dịch tối đa toàn bot trong một phút. |
| `MAX_CONCURRENT_TRANSLATIONS` | Không | `8` | Hard cap số tác vụ Google chạy song song; hàng đợi chờ tối đa gấp đôi giá trị này. |
| `TRANSLATION_TIMEOUT_MS` | Không | `15000` | Timeout mỗi request, từ 1.000 đến 60.000 ms. |
| `MIN_LANGUAGE_CONFIDENCE` | Không | `0.6` | Ngưỡng confidence nhận diện, từ `0` đến `1`. |

Dùng lệnh `/id` để lấy chat ID cần đưa vào allowlist; riêng lệnh này được phép với rate limit thấp để bootstrap cấu hình. Chat ngoài allowlist bị bỏ qua và không tiêu tốn quota Google. Nếu cả allowlist lẫn `TELEGRAM_ALLOW_ALL_CHATS=true` đều thiếu, bot chỉ chạy chế độ bootstrap `/id`, không dịch bất kỳ tin nhắn nào — billing không bị mở cho cả Internet.

## Dùng trong group

Telegram mặc định bật privacy mode, khiến bot trong group không nhận mọi tin nhắn thường. Nếu muốn bot dịch tất cả tin nhắn trong group:

1. Mở BotFather → `/setprivacy`.
2. Chọn bot → `Disable`.
3. Xóa bot khỏi group rồi thêm lại nếu Telegram chưa áp dụng thay đổi.

Bot bỏ qua tin nhắn của bot khác và command để tránh loop. Bản dịch được gửi dạng plain text, không render HTML từ nội dung người dùng.

Nếu group đông, nên giữ privacy mode và yêu cầu thành viên nhắn riêng cho bot. Tắt privacy mode đồng nghĩa mọi text trong group có thể được gửi sang Google và tính phí.

## Kiểm tra

```powershell
npm.cmd run check
```

Lệnh này chạy ESLint và toàn bộ unit test bằng test runner tích hợp của Node.js.

## Lưu ý vận hành

- Cloud Translation là dịch vụ có tính phí. Nên cấu hình budget/quota trong Google Cloud và đặt `TELEGRAM_ALLOWED_CHAT_IDS`.
- Tin nhắn chỉ có emoji, số hoặc dấu câu sẽ không được gửi tới Google.
- Mỗi tin hợp lệ gọi `detectLanguage`, sau đó mới gọi `translateText` với source/target rõ ràng. Ngôn ngữ khác hoặc confidence thấp chỉ tốn request nhận diện và không được dịch.
- Nội dung tin nhắn được gửi tới Google Cloud Translation để nhận diện/dịch. Bot không lưu hoặc log nội dung; log lỗi chỉ chứa chat ID, message ID và loại lỗi.
- Lỗi API Telegram như `429`/server error được retry tối đa ba lần khi thời gian chờ không vượt 10 giây; `retry_after` dài hơn sẽ trả lỗi ngay. Lỗi mạng mơ hồ không tự retry `sendMessage` để giảm nguy cơ gửi bản dịch trùng.
- Khi khởi động, bot xóa webhook nhưng giữ nguyên update đang chờ rồi mới chạy long polling. Mỗi token chỉ nên chạy một instance tại một thời điểm.

Tài liệu API: [Google Cloud Translation v3](https://cloud.google.com/translate/docs/advanced/translating-text-v3), [Telegram Bot API](https://core.telegram.org/bots/api).
