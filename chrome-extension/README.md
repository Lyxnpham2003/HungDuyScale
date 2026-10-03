# Extension Chrome "Cân HR-250A"

Nhận số cân từ hộp **HungDuyScaleHR250A** (ESP32 WT32-ETH01 nối cân A&D HR-250A) qua WebSocket trong mạng LAN, rồi gọi `window.HR250A_onData(data)` trên **một** tab `qlcl.hungduy.vn`.

```
Hộp cân ws://<ip>:81/ ──JSON──► extension ──(ổn định, mẫu mới)──► window.HR250A_onData(data) trên tab qlcl
```

## Cài đặt

1. Chrome → `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `chrome-extension/` này.
3. Bấm biểu tượng extension → ⚙ → nhập **IP của hộp cân** (ghi trên vỏ hộp), port `81` → **Kiểm tra & lưu**. Nút này chỉ lưu khi hộp cân trả về số cân; **Lưu cài đặt** thì lưu luôn mà không kiểm tra.
   Chưa biết IP của hộp: dùng mục **Cài đặt hộp cân lần đầu** → **Tìm hộp cân** (xem `docs/huong-dan-setup-cho-IT.md`).
4. Phía web cần có `window.HR250A_onData`: đã thêm vào `QuanLyChatLuong/Views/Shared/_Layout.cshtml` (bản gốc để tham khảo ở `web-snippet/HR250A_onData.js`).
5. Dev/test web chạy local (ví dụ `https://localhost:7008`): trong ⚙ bật **Cho phép gửi vào web chạy local**.

## Khi nào số cân được gửi vào web

| Cân báo | Kết quả |
|---|---|
| Ổn định, đơn vị g, > ngưỡng (mặc định 0.0010 g), là mẫu mới | **Gửi 1 lần** |
| Vẫn ổn định ở cùng số, hoặc chập chờn ổn định ↔ chưa ổn định | Không gửi lại |
| Đĩa trống (≤ ngưỡng, kể cả số âm) | Không gửi; lần cân sau được gửi, kể cả đúng số cũ |
| Chưa ổn định / quá tải / chế độ đếm / đơn vị khác g | Không gửi |
| Load lại trang | Không gửi lại số cũ |

- Mở nhiều tab qlcl thì chỉ gửi vào tab đang active (hoặc tab dùng gần nhất). Tab `localhost` / `127.0.0.1` chỉ được tính khi bật option chạy local.
- Mọi lần gửi được ghi trong popup (20 lần gần nhất), kèm kết quả: ✓ đã gửi, hoặc ✗ kèm lý do (không có tab, trang chưa có hàm...).
- Ngoài ra extension giữ **lịch sử cân** 5000 lần gần nhất (xem mục dưới) để xuất CSV sao lưu.
- Nút **Gửi lại vào web** gửi lại lần gần nhất, dùng khi lỡ bấm Hủy trên popup của web.
- Nút **Về 0** / **Trừ bì** gửi lệnh `Z` / `T` xuống cân qua hộp.

## Lịch sử cân và xuất CSV (sao lưu)

Mỗi lần gửi số cân vào web (tự động hoặc **Gửi lại**, kể cả lần gửi lỗi) được ghi vào lịch sử cân trong `chrome.storage.local` của máy đó, tối đa **5000 lần gần nhất**. Lần cũ hơn tự bị xoá.

- Popup → **Xuất CSV…** (hoặc ⚙ → mục **Lịch sử cân**) → **Xuất CSV**. File `lich-su-can-HR250A-YYYYMMDD-HHmm.csv` được lưu vào thư mục Tải xuống.
- Các cột: Ngày, Giờ (giờ máy tính lúc gửi), Khối lượng (đúng số lẻ của cân), Đơn vị, Trạng thái, Mô phỏng, Nguồn (Tự động / Gửi lại), Gửi vào web (Đã gửi / Lỗi), Lý do lỗi, MAC hộp cân, IP hộp cân, Thời điểm (ISO, UTC). Dòng cũ nhất ở trên.
- File là UTF-8 có BOM, phân cách bằng dấu phẩy, số thập phân dùng dấu chấm. Nếu Excel dồn hết vào một cột (máy đặt vùng Việt Nam), mở bằng **Data → From Text/CSV**, chọn phân cách *Comma*.
- **Xoá lịch sử…** phải bấm thêm **Chắc chắn xoá** mới xoá. Lịch sử 20 lần trong popup không bị xoá theo.
- Lịch sử chỉ nằm trên máy đang chạy extension. Gỡ extension là mất lịch sử, nên hãy xuất CSV định kỳ, ví dụ cuối mỗi ca.

## Chạy thử khi chưa có cân thật

**Có hộp ESP32, chưa gắn cân:** hộp cắm mạng như bình thường. Vào ⚙ → phần **Chạy thử** → **Bật mô phỏng** → nhập khối lượng → **Đặt mẫu**. Firmware tự tạo dòng dữ liệu giống cân thật (chưa ổn định khoảng 2 giây rồi mới ổn định), mọi thứ phía sau đều chạy thật. Popup hiện badge **MÔ PHỎNG**. Khởi động lại hộp là tắt mô phỏng.

**Không có cả hộp:** chạy hộp giả trên máy tính:
```
node tools/fake-device.mjs            # port 81
node tools/fake-device.mjs --port 8181
```
Trỏ extension tới `127.0.0.1` với port tương ứng. Gõ `put 12.3456`, `remove`, `ol`, `z`, `auto on`... trong cửa sổ đó, hoặc dùng các nút Chạy thử trong Options.

## Test

```
npm test        # = node --test (Node ≥ 22, không cần npm install)
```

| File | Kiểm tra |
|---|---|
| `test/lib.test.js` | config, parse message, quy tắc gửi (push-gate), chọn tab, backoff, lịch sử, lịch sử cân + xuất CSV; kiểm tra IP/gateway/mask trước khi đặt IP, dải mạng quét, pool quét song song, message CMD:NET |
| `test/connection.test.js` | kết nối lại với backoff, ngắt chủ động, probe "Kiểm tra kết nối"; netRequest (trả lời net, bỏ qua reading đến trước, firmware cũ, hết giờ, lỗi) |
| `test/notifier.test.js` | chỉ inject vào 1 tab, các lý do lỗi |
| `test/service.test.js` | luồng tích hợp: chuỗi đọc cân → gửi đúng 2 lần, lệnh, gửi lại, cài đặt, lịch sử cân (ghi, xoá, chuyển từ history cũ); scanNetwork, useDevice, setDeviceNetwork (thành công, hết 10 phút, nhập sai, không thấy ở IP mới, MAC khác, DHCP) |
| `test/e2e-fake-device.test.js` | socket thật: hộp giả ⇄ WebSocket ⇄ service; quét 127.0.0.x thấy fake device, đặt IP, hết 10 phút |

## Cấu trúc

```
manifest.json
src/lib/          logic thuần (không đụng chrome.* / WebSocket): config, reading, push-gate, tab-picker, backoff, history, weigh-log (lịch sử cân + CSV), messages
src/background/   connection (WebSocket + kết nối lại), notifier (inject vào tab), service (nối tất cả), main (gắn API Chrome)
src/popup/        popup: số cân, trạng thái, nút lệnh, lịch sử
src/options/      cài đặt + panel chạy thử
tools/            fake-device.mjs
web-snippet/      mẫu window.HR250A_onData cho web
```

Dữ liệu thiết bị gửi lên (từ firmware `readingToJson()`):
```json
{"type":"reading","device":"HR250A","header":"ST","stable":true,"unstable":false,"overload":false,"counting":false,"count":null,"value":12.3456,"unit":"g","weight":"12.3456 g","raw":"ST,+012.3456  g","uptime":12345,"sim":true}
```
