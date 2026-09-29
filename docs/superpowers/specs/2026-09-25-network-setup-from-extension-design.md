# Cài đặt mạng cho hộp cân từ extension (không cần Serial Monitor)

- Ngày: 2026-09-25
- Trạng thái: chờ duyệt spec
- Phạm vi: firmware 0.3.0 → **0.4.0**, extension 1.0.0 → **1.1.0**, tài liệu bàn giao

## 1. Bối cảnh và mục tiêu

Hộp cân sẽ được giao cho IT nhà máy. IT chỉ có trong tay:
- cân HR-250A,
- hộp ESP32 WT32-ETH01 đã nạp firmware,
- extension "Cân HR-250A",
- quyết định sẽ dùng một IP cố định cho hộp. Việc này đã thống nhất, nhưng IP cụ thể chưa có; IT sẽ chọn khi nhận hàng.

IT **không có Serial Monitor**, nên không gõ được `CMD:STATUS` hay `CMD:IP`. Hiện tại muốn đổi IP hoặc xem IP của hộp chỉ có cách qua USB Serial.

**Mục tiêu:** IT tự làm toàn bộ việc setup bằng extension, theo một trong hai hướng.
- **Hướng A:** IT giữ IP theo MAC trên router (DHCP reservation). Extension chỉ cần tìm ra hộp rồi lưu IP.
- **Hướng B:** IT đặt IP tĩnh ngay trên hộp, thông qua extension.

**Tiêu chí thành công:**
1. Cắm hộp vào mạng có DHCP. Trên máy tính, IT bấm "Tìm hộp cân" và thấy hộp, kèm MAC trùng với nhãn dán.
2. Hướng A: bấm "Dùng IP này" thì extension lưu IP đó và bắt đầu nhận số cân.
3. Hướng B: trong 10 phút đầu sau khi cắm điện, IT nhập IP/gateway. Hộp lưu và khởi động lại; extension tự tìm thấy hộp ở IP mới, lưu IP và nhận số cân.
4. Sau 10 phút đầu, không ai đổi được IP của hộp qua mạng.
5. Luồng số cân hiện có (JSON reading, push gate, extension EK-610i) không thay đổi.

**Ngoài phạm vi:** mạng không có DHCP (trường hợp này gửi hộp về đặt IP qua Serial), mDNS, bảo vệ bằng PIN, cấu hình khác qua mạng (baud, poll…).

## 2. Firmware (0.4.0)

### 2.1. Cửa sổ setup
- `SETUP_WINDOW_MS = 600000` (10 phút) được khai báo trong `config.h`.
- Cửa sổ đang mở khi `millis() < SETUP_WINDOW_MS` **và** lần khởi động này là do cắm điện thật: `esp_reset_reason()` là `ESP_RST_POWERON`, `ESP_RST_EXT` (nút EN) hoặc `ESP_RST_BROWNOUT` (sụt áp). Khởi động lại bằng phần mềm (`ESP.restart()`, kể cả lần do `CMD:NET:SET` gây ra), panic hay watchdog đều giữ cửa sổ đóng. Nhờ vậy "người chạm được hộp mới đổi được IP", và không ai trong LAN giữ cửa sổ mở mãi được bằng cách gửi `SET` liên tục. *(Bổ sung sau review cuối: bản đầu cho mọi lần khởi động lại đều mở lại cửa sổ.)*

### 2.2. Lệnh mới qua WebSocket
Chỉ nhận qua WebSocket, được xử lý trong `ws_server.ino`. Câu trả lời gửi **riêng cho client đã gửi lệnh** (`webSocket.sendTXT(num, …)`), không broadcast.

| Lệnh | Điều kiện | Trả lời |
|---|---|---|
| `CMD:NET:INFO` | luôn nhận | `{"type":"net","ok":true,"device":"HR250A","id":"<MAC>","ip":"<ip>","mode":"dhcp"\|"static","setupLeftSec":<n>,"fw":"0.4.0"}` |
| `CMD:NET:SET:<ip>,<gw>[,<mask>[,<dns>]]` | cửa sổ đang mở, tham số hợp lệ | `{"type":"net","ok":true,"msg":"saved","restartInMs":1500}` rồi khởi động lại |
| `CMD:NET:DHCP` | cửa sổ đang mở | tương tự `SET` |
| cửa sổ đã đóng | | `{"type":"net","ok":false,"error":"setup-closed"}` |
| tham số sai hoặc lệnh `NET` không biết | | `{"type":"net","ok":false,"error":"bad-args"}` |

- `setupLeftSec = max(0, (SETUP_WINDOW_MS - millis()) / 1000)`.
- `mask` mặc định là `255.255.255.0`, `dns` mặc định rỗng (khi chạy sẽ dùng gateway). Quy tắc giống `CMD:IP` hiện có.
- Các `CMD:*` khác gửi qua WebSocket vẫn bị từ chối như trước. Riêng `CMD:SIM:*` vẫn được nhận.

### 2.3. Thay đổi code
- `commands.ino`: tách đoạn parse, kiểm tra và lưu IP của `CMD:IP` ra hàm `bool applyStaticIp(const String &args)`, cùng với `void applyDhcp()`. Lệnh `CMD:IP` và `CMD:IP:DHCP` qua Serial gọi lại các hàm này, hành vi và log giữ nguyên.
- `ws_server.ino`:
  - Giới hạn độ dài lệnh nâng từ `> 32` lên `> 96`.
  - Thêm nhánh `CMD:NET:`, và hàm `netInfoJson()` tạo JSON trả về.
- Hẹn giờ khởi động lại: biến `restartAt` (0 = không hẹn); `loop()` gọi `ESP.restart()` khi `millis() >= restartAt`. Không dùng `delay()` trong callback WebSocket, để câu trả lời kịp gửi đi trước khi khởi động lại.
- `firmwareVer` → `"0.4.0"`.
- `CMD:HELP` bổ sung dòng mô tả các lệnh `CMD:NET:*` (qua WebSocket).

### 2.4. Tương thích
- JSON `type:"reading"` giữ nguyên.
- JSON `type:"net"` chỉ được gửi cho client vừa gửi `CMD:NET:*`. Extension EK-610i không bao giờ gửi lệnh này, nên không bao giờ nhận JSON đó.
- Hộp chạy firmware 0.3.0 không trả lời `CMD:NET:INFO`. Extension vẫn nhận ra đó là hộp HR250A nhờ JSON số cân (xem mục 3.1).

### 2.5. Fake device
`tools/fake-device.mjs` cài đặt đủ 3 lệnh trên:
- `setupLeftSec` được giả lập. Thêm cờ `--setup-closed` để giả lập trường hợp cửa sổ đã đóng.
- `SET` chỉ ghi nhận IP mới rồi trả về `ok`. Fake device không đổi IP thật được, nên việc dò lại ở IP mới được kiểm tra trong test bằng WebSocket giả.

## 3. Extension (1.1.0)

### 3.1. Quét dải mạng: `src/lib/scan.js` (logic thuần)
- `normalizePrefix(input)` nhận `"172.16.10"` hoặc `"172.16.10.x"`, trả về 3 octet hợp lệ hoặc lỗi.
- Hàm tạo danh sách host `.1`…`.254`.
- `runPool(items, limit, worker)`: chạy tối đa `limit` (mặc định 32) việc cùng lúc, báo tiến độ qua callback.
- Kết quả với mỗi IP, dùng `probeNet()` trong `connection.js`, có timeout 1500 ms:
  - Nhận `type:"net"` với `device:"HR250A"` → `{ip, id, mode, setupLeftSec, fw, canSetup: setupLeftSec > 0}`.
  - Nhận `type:"reading"` với `device:"HR250A"` nhưng không có `net` (firmware cũ) → `{ip, id, legacy: true, canSetup: false}`.
  - Không có trả lời, lỗi, hoặc hết thời gian → bỏ qua.
- Dải mạng mặc định lấy 3 octet đầu của `deviceIp` đang lưu, nếu chưa có thì dùng `172.16.10`.

### 3.2. `reading.js`
Thêm `parseNetMessage(text)`, trả về object `net` hoặc `null`. Trong `handleDeviceMessage`, message `type:"net"` **không** tăng `badMessages` và không đi vào push gate.

### 3.3. Action mới trong `service.js`
- `scanNetwork {prefix, wsPort}` → `{ok, devices:[…]}`. Tiến độ được ghi vào `live.scan = {done, total}` (session storage, throttle 300 ms như hiện có).
- `useDevice {ip, wsPort}` → lưu `deviceIp`/`wsPort` qua đường `testConnection {save:true}` hiện có, rồi kết nối lại.
- `setDeviceNetwork {currentIp, wsPort, ip, gw, mask, dns}`:
  1. Kiểm tra dữ liệu: `ip`, `gw` là IPv4 hợp lệ; `mask`, `dns` rỗng hoặc hợp lệ; `ip` và `gw` cùng subnet theo mask; `ip` khác `gw`. Nếu sai thì trả `{ok:false, error}` và không gửi gì. Với `CMD:NET:DHCP` thì bỏ qua bước này.
  2. Mở kết nối riêng tới `currentIp`, gửi `CMD:NET:SET:…` (hoặc `CMD:NET:DHCP`), chờ trả lời `type:"net"` tối đa 5 s.
  3. Nếu trả về `setup-closed`: báo "Hết 10 phút cài đặt. Rút điện, cắm lại hộp rồi làm lại trong 10 phút." Nếu trả về `bad-args`: báo lỗi tham số.
  4. Nếu `ok`: đợi `restartInMs`, rồi dò `ip` mới bằng `CMD:NET:INFO` mỗi 2 s, tối đa 40 s. Chỉ tính thành công khi `id` trùng MAC ban đầu.
  5. Nếu tìm thấy: lưu `deviceIp = ip`, gọi `loadConfig()` và `applyConnectionPolicy()`, trả `{ok:true, ip, id}`.
  6. Nếu hết 40 s: trả `{ok:false, error:"Hộp đã lưu IP mới nhưng chưa thấy ở <ip>. Kiểm tra IP/gateway có cùng dải mạng không; hộp vẫn giữ IP mới."}`, **không** lưu vào extension.
- `sendCommand` và `ALLOWED_COMMAND` giữ nguyên. Lệnh `CMD:NET` chỉ được gửi qua các action riêng ở trên.

### 3.4. Giao diện
- **Options:** thêm khung "Cài đặt hộp cân lần đầu", đặt trên form hiện có.
  - Ô dải mạng, ô port, nút **Tìm hộp cân**, dòng tiến độ.
  - Mỗi hộp tìm thấy là một dòng: IP, MAC (6 số cuối, bấm để xem đủ), DHCP/tĩnh, "còn N phút setup" hoặc "hết thời gian setup" hoặc "firmware cũ", và hai nút **Dùng IP này**, **Đặt IP cố định…**. Nút thứ hai bị mờ khi `canSetup = false`, kèm dòng giải thích.
  - Form đặt IP: IP, Gateway, Mask (mặc định `255.255.255.0`), DNS (tuỳ chọn), nút **Lưu IP vào hộp**. Trạng thái hiện theo từng bước: "Đang gửi… → Hộp đang khởi động lại… → Đã thấy hộp ở X ✓ Đã lưu. Ghi IP lên vỏ hộp."
- **Popup:** thêm dòng "Hộp: `<ip>` · MAC `…D4E5F6`", với `id` lấy từ số cân gần nhất.

## 4. Test

| Tầng | Nội dung |
|---|---|
| `test/lib.test.js` | `normalizePrefix`, tạo danh sách host, `runPool` không vượt giới hạn và đủ kết quả, `parseNetMessage` |
| `test/connection.test.js` | `probeNet`: nhận `net`; chỉ nhận reading (firmware cũ); hết thời gian; lỗi |
| `test/service.test.js` | `scanNetwork` (có tiến độ); `useDevice` lưu IP; `setDeviceNetwork` với các nhánh thành công, `setup-closed`, `bad-args`, dữ liệu sai, không thấy ở IP mới (không lưu), MAC khác (không tính thành công); message `net` không làm tăng `badMessages` |
| `test/e2e-fake-device.test.js` | Quét `127.0.0.1` thấy fake device; gửi `SET` nhận `ok`; khi fake device chạy `--setup-closed` thì nhận `setup-closed` |
| Firmware | `arduino-cli compile` không lỗi. Trên board thật: `CMD:NET:INFO` qua WebSocket; `SET` trong 10 phút đầu → hộp khởi động lại với IP mới; sau 10 phút → `setup-closed`; `CMD:IP` qua Serial vẫn chạy như cũ |

Toàn bộ `npm test` phải pass.

## 5. Bàn giao
- **Trang hướng dẫn setup cho IT** (tiếng Việt, không cần Serial Monitor), gồm:
  - cắm hộp;
  - cài extension;
  - tìm hộp cân;
  - hướng A: giữ IP theo MAC, rồi Dùng IP này;
  - hướng B: đặt IP cố định trong 10 phút đầu;
  - ghi IP lên vỏ hộp;
  - xử lý sự cố: không tìm thấy hộp, hết 10 phút, sai dải mạng.
- **Nhãn dán hộp:** MAC có dấu `:` và hostname `hdscale-hr250a-XXXXXX`, lấy từ kết quả `CMD:STATUS` do chủ dự án cung cấp.
- Nạp firmware 0.4.0 vào hộp trước khi giao.
- Cập nhật `CLAUDE.md`, `NOTES.md`, `chrome-extension/README.md`, `and_hr250a_rs232_esp32.md` §6.2.

## 6. Rủi ro
- **Quét chậm hoặc bị chặn:** firewall máy IT, hoặc máy IT ở VLAN khác với hộp. Khi quét không thấy hộp, extension hiện gợi ý "Máy tính và hộp phải cùng dải mạng; có thể nhập IP tay".
- **Nhập sai gateway hoặc dải mạng** khiến hộp mất kết nối ở IP mới. Cách khắc phục: rút điện cắm lại (cửa sổ setup mở lại), nhưng hộp vẫn giữ IP sai, nên chỉ quét được nếu IP sai đó còn nằm trong dải của máy IT. Phương án cuối là giữ nút IO2 để factory reset, tuy nhiên nút này đang có nghi vấn (xem CLAUDE.md "Known issues"). Vì vậy extension phải kiểm tra trước khi gửi: IP và gateway phải cùng subnet theo mask, nếu không thì chặn.
- **Mất điện trong cửa sổ setup** làm cửa sổ mở lại 10 phút. Rủi ro này chấp nhận được với mạng nội bộ nhà máy.
