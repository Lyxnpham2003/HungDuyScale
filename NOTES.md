# Ghi chú tiến độ: HR-250A → ESP32 → Extension → Web QLCL

Cập nhật: 2026-09-24

## Đã xong và đã kiểm tra

| Phần | Trạng thái | Kiểm tra bằng |
|---|---|---|
| Firmware v0.3.0 (đọc cân A&D, WebSocket, Ethernet, IP tĩnh, mô phỏng) | ✅ Đã nạp vào board thật | Log khởi động OK; WebSocket từ PC → ESP nhận đúng chuỗi mô phỏng US → ST 12.3456 → nhấc → ST 0.0000 |
| Extension "Cân HR-250A" v1.0.0 (`chrome-extension/`) | ✅ Chạy với ESP thật | 75/75 test (`npm test`); test tay với ESP + trang test |
| Hàm `window.HR250A_onData` trong `QuanLyChatLuong/Views/Shared/_Layout.cshtml` | ✅ Đã commit ("thêm hàm để test") | Build sln 0 lỗi |
| Setup IP từ extension (firmware 0.4.0 + extension 1.1.0) | ✅ code + test (firmware chưa build) | npm test; checklist board thật ở plan Task 8 Step 7 |
| Trang test không cần đăng nhập `https://localhost:7008/test-hr250a.html` | ✅ Chỉ ở máy local, không commit (đã thêm vào `.git/info/exclude` của repo web) | Nhận được dữ liệu từ extension |

Board test: WT32-ETH01, MAC ETH lấy từ `CMD:STATUS`, IP **172.16.10.223 (DHCP, tạm thời)**. Nạp bằng CP210x (số cổng COM đổi mỗi lần cắm lại, lần trước là COM10).

## Việc còn lại

### Không cần cân (làm được ngay)
- [ ] **Build + nạp firmware 0.4.0**, chạy checklist board thật (plan `docs/superpowers/plans/2026-09-25-network-setup-from-extension.md`, Task 8 Step 7) và thử tay giao diện extension (Task 9 Step 6).
- [ ] **Giao hộp cho IT:** nạp firmware 0.4.0, dán nhãn MAC `78:1C:3C:CA:2F:A7` / `hdscale-hr250a-CA2FA7`, gửi kèm `docs/huong-dan-setup-cho-IT.md`.
- [ ] **Test nút reset IO2** sau khi đặt IP tĩnh (chủ dự án tự test, báo kết quả).
- [ ] **Arduino IDE:** đặt *Erase All Flash* = **Disabled** (nếu để Enabled, mỗi lần nạp sẽ mất IP tĩnh đã lưu) và *Partition* = **No OTA**.
- [ ] **Web (anh Trí):** thêm ô nhận khối lượng vào màn hình cần dùng: id `cboWeight…` hoặc `name="khoiLuong"`, hoặc sửa `HR250A_FIELDS` trong `_Layout.cshtml`. Hiện chưa có màn hình nào có ô này nên web chỉ hiện toast.
- [ ] Khi đưa vào dùng thật: tắt option **"Cho phép gửi vào web chạy local"** trong extension.
- [ ] Làm hộp: cục sạc 5V ≥ 1A, hộp nhựa, cố định dây (dây Dupont lỏng từng gây lỗi khi nạp).

### Khi có module MAX3232 và cân thật
- [ ] Đấu dây theo mục 3 của `and_hr250a_rs232_esp32.md`: TXD module → **IO5**, RXD module → **IO17**, VCC module → **3V3**, **không nối chân 9** của cân. Kiểm tra đầu DB9 của module là **cái**.
- [ ] Bấm **Tắt mô phỏng** (hoặc khởi động lại hộp; mô phỏng không được lưu).
- [ ] Chạy checklist bên dưới.

## Checklist test với cân thật

Mở Serial Monitor 115200 (gõ `CMD:RAW:ON` để xem hex nếu cần), extension và trang test.

1. **Có dữ liệu không:** bật cân, Serial phải in JSON `{"type":"reading",...}` khoảng 2 lần/giây.
   - Không có gì: đảo IO5 ↔ IO17; gõ `Q` bằng tay; bấm PRINT trên cân.
   - Ký tự rác / `[RESP]` lạ: sai baud hoặc parity. Xem nhóm `SIF` trên cân, rồi chỉnh `CMD:BAUD:<n>` / `CMD:FMT:8N1`.
2. **Đúng số:** `valueText` trong JSON = số trên màn hình cân, đủ 4 số lẻ, đúng dấu âm khi trừ bì.
3. **Ổn định:** `stable` chuyển true/false theo đèn ổn định trên cân.
4. **Web nhận 1 lần:** đặt mẫu → trang test thêm đúng 1 dòng khi cân ổn định. Nhấc mẫu → không thêm dòng. Đặt lại → thêm 1 dòng.
5. **Về 0 / Trừ bì** trong popup extension → cân về 0.
6. **Quá tải** (nếu thử được an toàn) → popup hiện "Quá tải", web không nhận gì.
7. **Để chạy lâu** (vài giờ): extension vẫn "Đã kết nối"; rút dây mạng rồi cắm lại, extension phải tự kết nối lại.

## Những chỗ có thể phải chỉnh sau khi thấy dữ liệu thật

Các giả định dưới đây lấy từ manual, **chưa đối chiếu với cân thật**:

| Giả định | Nếu thực tế khác thì sửa ở |
|---|---|
| Dòng dữ liệu dạng `ST,+00012.3456  g` (header 2 ký tự, dấu phẩy ở vị trí thứ 3) | `parseBalanceLine()` trong `and_balance.ino` |
| Header chỉ có ST / US / OL / QT | `parseBalanceLine()`; extension `src/lib/reading.js` |
| Dòng quá tải dạng `OL,+9999999E+19` | `parseBalanceLine()` (hiện bỏ qua phần số khi OL) |
| Lỗi có dạng `EC,Exx`, AK = 0x06 | `processBalanceLine()` |
| 2400 bps, 7E1 | Chỉnh bằng lệnh `CMD:BAUD` / `CMD:FMT` (được lưu), không cần sửa code |
| Cân trả lời lệnh `Q` ở mọi chế độ | Nếu không trả lời: đặt cân sang stream (`Prt` = 3) và `CMD:POLL:0` |
| Hỏi cân mỗi 500 ms là đủ nhanh | `CMD:POLL:<ms>` |
| Ngưỡng đĩa trống 0.0010 g (cân có độ đọc 0.0001 g, có thể trôi số khi không có mẫu) | ⚙ của extension → "Ngưỡng tối thiểu" |
| Cân luôn ở đơn vị g | Nếu cần mg: sửa luật trong `src/lib/push-gate.js` (hiện chỉ gửi khi đơn vị là g) |

Sau khi sửa firmware: `arduino-cli compile ...` hoặc Upload trong IDE (Erase Flash **Disabled**). Sau khi sửa extension: `npm test`, rồi bấm ↻ Reload trong `chrome://extensions`.

## Tài liệu liên quan
- `CLAUDE.md`: kiến trúc, file, protocol (cho người sửa code)
- `and_hr250a_rs232_esp32.md`: phần cứng, đấu dây, nguồn, nạp firmware, lệnh, chạy thử mô phỏng
- `chrome-extension/README.md`: cài extension, luật gửi, test, hộp giả
- `tài liệu cân A&D HR-250A.pdf`: manual gốc (RS-232 ở trang 76–84)
