# Kết nối cân A&D HR-250A với web QLCL qua ESP32 (WT32-ETH01)

Tài liệu này mô tả phần cứng, cách đấu nối, nguồn điện, thông số truyền thông và cách nạp/cấu hình firmware `HungDuyScaleHR250A` để đưa số cân của **A&D HR-250A** lên web Quản lý chất lượng (`qlcl.hungduy.vn`).

> Các thông số dưới đây là mặc định của dòng cân A&D HR-A. Nên đối chiếu thêm với sách hướng dẫn chính hãng (`tài liệu cân A&D HR-250A.pdf`) nếu cân đã được cài đặt lại.

```
Cân HR-250A ──RS-232──► MAX3232 ──TTL──► WT32-ETH01 ──Ethernet──► Chrome extension ──► web QLCL
 (adapter 12V riêng)        (nguồn 3V3 lấy từ ESP)  (cục sạc 5V riêng)   ws://<ip>:81/       window.*_onData()
```

---

## 1. Thông tin cân

| Mục | Giá trị |
|---|---|
| Hãng / Model | A&D Company Limited – HR-250A |
| Mức cân tối đa | 252 g |
| Độ đọc | 0,1 mg (0,0001 g) |
| Nguồn | AC Adapter DC 12V 0,3A (của cân, giữ nguyên) |
| Cổng giao tiếp | RS-232C, DB-9 **đực** (kiểm tra trên máy thật; manual ghi "female" nhưng thực tế là đầu đực), trụ ren 4-40 UNC |
| Vai trò | DCE (dùng được cáp thẳng với máy tính) |
| Tài liệu | Manual chung HR-AZ / HR-A series (HR-250AZ/251AZ/150AZ/100AZ, HR-250A/251A/150A/100A) |

---

## 2. Phần cứng cần có

| Thiết bị | Ghi chú |
|---|---|
| **WT32-ETH01 v1.4** | ESP32 có sẵn cổng Ethernet (LAN8720) |
| **Module RS232 ↔ TTL MAX3232 / SP3232** | 4 chân VCC / TXD / RXD / GND. Đầu DB-9 phải là **cái** để cắm thẳng vào cổng đực của cân. Nếu module là đầu đực thì mua thêm đầu đổi **cái-cái nối thẳng** (gender changer), **không dùng loại null-modem** |
| **Nguồn 5V riêng cho ESP** | Cục sạc điện thoại 5V ≥ 1A + dây USB cắt đầu (hoặc module nguồn 5V). Xem mục 2.1 |
| **Dây mạng + 1 cổng switch** | Cắm vào LAN cùng dải với máy tính mở web (`172.16.10.x`) |
| **USB-TTL (CH340/CP2102)** | Chỉ dùng để nạp firmware và xem Serial Monitor. WT32-ETH01 không có cổng USB |
| **2 vít đực 4-40 UNC** dài 10–15 mm | Thay trụ lục giác trên module để vặn vào cân |
| Dây Dupont, hộp nhựa | Hộp nên ghi IP cố định lên vỏ (mục 6.2) |

### 2.1. Vì sao cần nguồn 5V riêng

- **Cổng RS-232 không có chân cấp nguồn.** Cổng DB-9 chỉ có tín hiệu (TXD, RXD, GND và các chân bắt tay DSR/RTS/CTS), mỗi chân chỉ cho ra vài mA. WT32-ETH01 chạy Ethernet cần khoảng **150–250 mA**, nên phải có nguồn riêng.
- **Chân 9 của cân (12V) không được dùng.** Manual trang 76 ghi chân này chỉ dành cho thiết bị A&D (*"Do not wire them connecting to other companies' products"*) và không công bố dòng tối đa. Kéo quá dòng hoặc chập là hỏng cân.
- **Module MAX3232 không cấp nguồn.** Nó chỉ chuyển mức điện áp, và chính nó cũng cần nguồn ở chân VCC. Dòng "hỗ trợ 3.3V–5V" trong mô tả sản phẩm là điện áp nó **nhận vào**. Bên trong có mạch bơm điện tích tự tạo ±5.5V cho phía RS-232, nên không cần nguồn âm riêng.

Tóm lại, cả hộp chỉ cần **một** cục sạc 5V: nó nuôi WT32-ETH01, và module MAX3232 lấy 3V3 từ WT32-ETH01. Cân dùng adapter 12V của nó như bình thường.

> Phương án gọn hơn nếu phòng lab có switch PoE: dùng **PoE splitter ra 5V**, khi đó một sợi dây mạng vừa truyền dữ liệu vừa cấp nguồn. WT32-ETH01 không có PoE sẵn nên phải thêm splitter.

### ⚠️ Không nối thẳng cân vào ESP32

- RS-232 dùng mức **±5 đến ±12 V**, có điện áp **âm** và logic **đảo**.
- GPIO của ESP32 chỉ chịu tối đa khoảng **3,6 V** và **không chịu được 5 V**.
- Bắt buộc dùng module MAX3232 để chuyển mức.

### Chuẩn bị module

1. Tháo 2 trụ lục giác trên đầu DB-9 của module: vặn ngược chiều kim đồng hồ bằng kìm hoặc tuýp 5 mm. Nếu có đai ốc phía sau thì giữ đai ốc lại khi vặn.
2. Xỏ vít đực 4-40 từ phía sau tai DB-9 ra trước.
3. Cắm module vào cổng RS-232C của cân rồi vặn vít vào trụ ren trên cân.

---

## 3. Sơ đồ đấu nối

```
                                                          Cục sạc 5V
                                                           │  │
 Cân A&D HR-250A            Module MAX3232                 │  │   WT32-ETH01
 (DB-9 đực)                 (DB-9 cái)                     │  │  ┌──────────────┐
 ┌──────────────┐           ┌───────────────┐              │  └──┤ 5V           │
 │ Pin 2 (TX) ──┼──────────►│ RS232 RX      │              └─────┤ GND          │
 │ Pin 3 (RX) ◄─┼───────────│ RS232 TX      │                    │              │
 │ Pin 5 (GND) ─┼───────────│ GND           │                    │              │
 │ Pin 9 (12V)  │ KHÔNG NỐI │          VCC ─┼────────────────────┤ 3V3          │
 └──────────────┘           │          GND ─┼────────────────────┤ GND          │
                            │  TXD (TTL) ───┼───────────────────►│ IO5  (RX)    │
                            │  RXD (TTL) ◄──┼────────────────────┤ IO17 (TX)    │
                            └───────────────┘                    │     [RJ45]───┼──► Switch LAN
                                                                 └──────────────┘
```

| Nối từ | Nối tới | Ghi chú |
|---|---|---|
| Cục sạc 5V (+) | WT32-ETH01 **5V** | Nguồn chính của hộp |
| Cục sạc GND (−) | WT32-ETH01 **GND** | |
| Module VCC | WT32-ETH01 **3V3** | **Không dùng 5V**: cấp 5V thì chân TXD của module ra mức 5V, làm hỏng IO5 |
| Module GND | WT32-ETH01 GND | |
| Module TXD (TTL) | WT32-ETH01 **IO5** | ESP nhận dữ liệu cân |
| Module RXD (TTL) | WT32-ETH01 **IO17** | ESP gửi lệnh cho cân (`Q`, `Z`, `T`...) |

> 📌 **Nhãn in trên WT32-ETH01:** IO5 và IO17 được in là **`RXD`** và **`TXD`** (UART2, nối module MAX3232). Cổng nạp firmware là **`RXD0`** và **`TXD0`** (IO3/IO1, nối USB-TTL). Hai cặp này dễ nhầm với nhau.

> ⚠️ **Không dùng GPIO16 cho UART.** Trên WT32-ETH01, GPIO16 là chân bật nguồn chip Ethernet (`ETH_PHY_POWER`). Firmware đã cố định RX=IO5, TX=IO17 (`BAL_RX_PIN` / `BAL_TX_PIN` trong `config.h`), giống project `HungDuyScale`.

Các chân DB-9 của cân:

| Chân | Tín hiệu | Hướng |
|---|---|---|
| 1 | Cùng điện thế SG | Không nối |
| 2 | TXD – dữ liệu cân gửi ra | Cân → module |
| 3 | RXD – dữ liệu cân nhận vào | Module → cân |
| 5 | GND | — |
| 6, 7, 8 | DSR / RTS / CTS | Không cần dùng |
| 9 | **Ngõ ra 12V** (dành cho thiết bị A&D) | **Tuyệt đối không nối** |

> ⚠️ **Chân 9 của cân xuất 12V.** Chỉ nối các chân 2, 3, 5. Nếu tự làm cáp hoặc dùng đầu chuyển, đảm bảo chân 9 không đi vào mạch nào khác.

> Nhãn TXD/RXD trên các module không thống nhất giữa các hãng. Nếu không nhận được dữ liệu, **đảo dây IO5 ↔ IO17** trước tiên.
>
> Kiểm tra bằng đồng hồ: khi cân bật, đo chân 2 và 3 so với chân 5. Chân nào có khoảng **−5 đến −12 V** là chân cân phát (TX).

---

## 4. Thông số truyền thông

| Thông số | Mặc định A&D |
|---|---|
| Tốc độ | **2400 bps** |
| Khung dữ liệu | **7 bit, parity chẵn, 1 stop bit (7E1)** (`btpr` = 0; có thể đổi sang 8N1 với `btpr` = 2) |
| Kết thúc dòng | CR LF (`\r\n`) |
| Handshake | Không |

Firmware mặc định dùng 2400 / 7E1. Nếu cân đã bị đổi cài đặt thì chỉnh bằng lệnh `CMD:BAUD:<n>` và `CMD:FMT:7E1|8N1` (mục 6.3).

### Cài đặt trên cân (bảng chức năng)

- Nhóm **`SIF`**: `bPS` là tốc độ baud, `btPr` là số bit và parity, `Crlf` là ký tự kết thúc.
- Nhóm **`dout`**, mục **`Prt`**: chọn cách gửi dữ liệu:
  - Gửi khi bấm phím PRINT
  - Tự động gửi khi ổn định
  - Gửi liên tục (stream)

Firmware mặc định tự hỏi cân bằng lệnh `Q` mỗi 500 ms, cân sẽ trả lời ở mọi chế độ nên **không cần đổi `Prt`**. Nếu muốn dùng chế độ stream hoặc phím PRINT thì tắt hỏi định kỳ bằng `CMD:POLL:0`.

---

## 5. Định dạng dữ liệu

Mỗi dòng cân gửi ra có dạng:

```
ST,+00012.3456  g<CR><LF>
```

| Phần | Ý nghĩa |
|---|---|
| `ST` / `US` / `OL` / `QT` | Ổn định / Chưa ổn định / Quá tải / Đếm số lượng |
| `,` | Dấu phân cách (vị trí thứ 3) |
| `+00012.3456` | Giá trị có dấu |
| `g` | Đơn vị (g, mg, pc, %…) |

Cân trả `EC,Exx` khi lỗi (ví dụ `EC,E02`: chưa sẵn sàng) và `<AK>` (06h) khi bật `erCd` = 1.

### Lệnh gửi cho cân

Mỗi lệnh kết thúc bằng `\r\n` (firmware tự thêm).

| Lệnh | Chức năng |
|---|---|
| `Q` | Đọc giá trị ngay |
| `S` | Đọc giá trị khi ổn định |
| `SI` | Đọc ngay một lần |
| `SIR` | Gửi liên tục |
| `C` | Dừng gửi liên tục |
| `Z` | Về 0 (RE-ZERO) |
| `T` | Trừ bì |
| `P` | Giống phím ON:OFF |
| `ON` / `OFF` | Bật / tắt màn hình |
| `PRT` | Giống phím PRINT |
| `CAL` | Giống phím CAL |
| `?ID` / `?SN` / `?TN` | Hỏi ID / số serial / tên model |

---

## 6. Firmware `HungDuyScaleHR250A`

Mã nguồn nằm ngay trong thư mục này. Chi tiết kỹ thuật cho người sửa code xem `CLAUDE.md`.

### 6.1. Nạp firmware

1. Arduino IDE, package `esp32 by Espressif Systems` **3.3.10**, board **WT32-ETH01 Ethernet Module**, Partition Scheme **No OTA (2MB APP/2MB SPIFFS)**.
2. Cài thư viện **WebSockets** của **Markus Sattler** (Library Manager, bản 2.7.2).
3. Nối USB-TTL: TX → **RXD0**, RX → **TXD0**, GND → GND, cấp 5V. Nối **IO0 xuống GND** rồi cấp nguồn lại để vào chế độ nạp. Upload, sau đó tháo IO0 khỏi GND và reset.
4. Mở Serial Monitor **115200**. Khởi động bình thường sẽ thấy:
   ```
   === HungDuyScaleHR250A v0.3.0 ===
   Settings loaded
     Balance baud: 2400
     Balance format: 7E1
     Poll (Q): 500 ms
     Network: DHCP
   UART2 initialized (RX:5 TX:17 Baud:2400 Format:7E1)
   ETH initialized (DHCP)
   WebSocket server on port 81
   ETH link up
   ETH IP: 172.16.10.xxx (DHCP) → ws://172.16.10.xxx:81/
   ```

### 6.2. Giữ IP cố định cho hộp

Extension kết nối tới hộp theo IP, nên IP của hộp **không được đổi**, giống các hộp đang chạy (ví dụ hộp ghi `172.16.10.69` trên vỏ). Có 2 cách.

#### Cài từ extension (không cần Serial Monitor)

Cần firmware ≥ 0.4.0 và extension ≥ 1.1.0. Trong ⚙ của extension, mục **Cài đặt hộp cân lần đầu** → **Tìm hộp cân**:
- Đã giữ IP trên router (cách 1): bấm **Dùng IP này**.
- Muốn đặt IP tĩnh (cách 2): trong 10 phút đầu sau khi cắm điện hộp, bấm **Đặt IP cố định…** → **Lưu IP vào hộp**.

Hướng dẫn từng bước cho IT: `docs/huong-dan-setup-cho-IT.md`. Hai cách dưới đây là cách làm qua Serial Monitor (cho người có cáp USB-TTL).

#### Cách 1 (khuyên dùng): nhờ IT giữ IP theo MAC (DHCP reservation)

Hộp vẫn chạy DHCP (mặc định), IT cấu hình router để luôn cấp cùng một IP cho MAC của hộp. Không cần sửa gì trên hộp.

1. Cắm mạng + nguồn, trong Serial Monitor gõ `CMD:STATUS` và ghi lại:
   - `ID:`: MAC Ethernet của hộp, 12 ký tự hex, ví dụ `A1B2C3D4E5F6`.
   - `ETH:`: IP hiện tại, phải có chữ `(DHCP)`.
2. Nếu dòng `ETH:` ghi `(static)` (hộp từng được đặt IP tĩnh), chuyển về DHCP trước: `CMD:IP:DHCP` rồi `CMD:RESTART`.
3. Gửi IT tin nhắn theo mẫu dưới. MAC phải thêm dấu `:` sau mỗi 2 ký tự: `A1B2C3D4E5F6` thành `A1:B2:C3:D4:E5:F6`.
4. Khi IT báo xong: rút cắm lại dây mạng (hoặc `CMD:RESTART`), rồi `CMD:STATUS`. Dòng `ETH:` phải hiện đúng IP đã giữ, kèm `(DHCP)`.
5. **Ghi IP lên vỏ hộp**, nhập IP vào ⚙ của extension, bấm **Kiểm tra & lưu**.

Mẫu tin nhắn gửi IT:

> Nhờ anh/chị giữ cố định IP (DHCP reservation) cho thiết bị hộp cân:
> - MAC: `A1:B2:C3:D4:E5:F6`
> - Hostname: `hdscale-hr250a-D4E5F6`
> - IP đang nhận: `172.16.10.xxx`
> - Vị trí cổng mạng: <phòng / bàn cân>
> - IP mong muốn giữ: <để trống nếu giữ IP đang nhận>

Hostname là `hdscale-hr250a-` cộng 6 ký tự cuối của MAC; IT tìm theo tên này trong danh sách thiết bị của router.

#### Cách 2: đặt IP tĩnh ngay trên hộp (khi IT không giữ IP được)

IP tĩnh phải **nằm ngoài dải IP mà router tự cấp (DHCP pool)**. Nếu không, router có thể cấp trùng IP đó cho máy khác.

1. Xin IT một IP trống ngoài dải DHCP trong `172.16.10.x`, và địa chỉ gateway.
2. Trong Serial Monitor gõ:
   ```
   CMD:IP:172.16.10.<x>,172.16.10.1
   CMD:RESTART
   ```
   (thay gateway cho đúng; có thể thêm subnet và DNS: `CMD:IP:<ip>,<gw>,<mask>,<dns>`)
3. Kiểm tra dòng `ETH IP: ... (static)` sau khi khởi động lại.
4. **Ghi IP lên vỏ hộp.**

Muốn quay lại DHCP: `CMD:IP:DHCP` rồi `CMD:RESTART`. Giữ nút IO2 5 giây để xóa toàn bộ cài đặt.

### 6.3. Lệnh qua Serial Monitor

Dòng bắt đầu bằng `CMD:` là lệnh firmware. Dòng khác (`Q`, `Z`, `T`, `SIR`...) được chuyển thẳng xuống cân.

| Lệnh | Tác dụng |
|---|---|
| `CMD:HELP` | Liệt kê lệnh |
| `CMD:STATUS` | Phiên bản, IP, số client WebSocket, cài đặt UART |
| `CMD:POLL:<ms>` | Chu kỳ gửi `Q` (mặc định 500; `0` = tắt) |
| `CMD:BAUD:<n>` | 600 / 1200 / 2400 / 4800 / 9600 / 19200 |
| `CMD:FMT:7E1` / `CMD:FMT:8N1` | Khung dữ liệu |
| `CMD:RAW:ON` / `OFF` | In hex từng dòng nhận được (dò lỗi) |
| `CMD:IP:<ip>,<gw>[,<mask>[,<dns>]]` / `CMD:IP:DHCP` | Cấu hình mạng (áp dụng sau `CMD:RESTART`) |
| `CMD:NET:INFO` / `CMD:NET:SET:…` / `CMD:NET:DHCP` | Chỉ qua WebSocket (extension dùng). SET/DHCP chỉ trong 10 phút đầu sau khi cắm điện |
| `CMD:RESTART` | Khởi động lại |
| `CMD:SIM:ON` / `OFF` | Bật/tắt chế độ mô phỏng (mục 6.6) |
| `CMD:SIM:PUT:<g>` / `CMD:SIM:REMOVE` / `CMD:SIM:OL` | Mô phỏng đặt mẫu / nhấc mẫu / quá tải |
| `CMD:SIM:AUTO:ON` / `OFF` | Mô phỏng tự lặp: đặt mẫu ngẫu nhiên 8 giây, nhấc ra 5 giây |

Baud, format, chu kỳ hỏi và IP được lưu lại sau khi mất điện. Chế độ mô phỏng thì **không** được lưu.

### 6.4. Dữ liệu gửi lên web

Mỗi lần đọc được, firmware in ra Serial và gửi qua WebSocket `ws://<ip>:81/` một dòng JSON:

```json
{"type":"reading","device":"HR250A","id":"<MAC>","header":"ST","stable":true,"unstable":false,"overload":false,"counting":false,"count":null,"value":12.3456,"unit":"g","weight":"12.3456 g","raw":"ST,+00012.3456  g","uptime":12345}
```

- Các field `value, unit, stable, unstable, overload, counting, count` giống hệt gateway của cân EK-610i, nên extension EK-610i cũng đọc được.
- Khi đang mô phỏng, JSON có thêm `"sim":true`.
- Lỗi `EC,Exx` chỉ in ra Serial, không gửi lên WebSocket.
- Client gửi text xuống WebSocket thì firmware chuyển thẳng cho cân (`Z`, `T`...). Riêng `CMD:SIM:*` điều khiển chế độ mô phỏng; các lệnh `CMD:*` khác chỉ nhận qua Serial.

### 6.5. Cài extension "Cân HR-250A"

Extension nằm ở thư mục `chrome-extension/`, hướng dẫn chi tiết trong `chrome-extension/README.md`.

1. Chrome → `chrome://extensions` → bật **Developer mode** → **Load unpacked** → chọn `chrome-extension/`.
2. Bấm biểu tượng extension → ⚙ → nhập IP của hộp, port `81` → **Kiểm tra kết nối** → **Lưu cài đặt**.
3. Phía web cần có hàm `window.HR250A_onData`. Mẫu để anh Trí dán vào `_Layout.cshtml` ở `chrome-extension/web-snippet/HR250A_onData.js` (cần sửa regex của ô nhập khối lượng).

Extension chỉ gửi vào web **một lần mỗi khi cân ổn định với mẫu mới**: không gửi khi đĩa trống (≤ 0.0010 g), không gửi lại khi load trang, và chỉ gửi vào một tab qlcl. Popup có nút Về 0 / Trừ bì, Gửi lại vào web, và lịch sử 20 lần gửi.

### 6.6. Chạy thử khi chưa gắn cân (chế độ mô phỏng)

Dùng để kiểm tra cả luồng **hộp ESP32 → mạng → extension → web** trước khi có module RS232 hoặc trước khi mang ra phòng lab. Mô phỏng thay cân ở đầu vào UART, còn toàn bộ phía sau chạy code thật.

1. Hộp cắm nguồn và mạng, đã có IP cố định (mục 6.2). Không cần cắm module MAX3232.
2. Extension trỏ tới IP của hộp (mục 6.5), mở `qlcl.hungduy.vn`.
3. Trong Options của extension, phần **Chạy thử**: bấm **Bật mô phỏng**, nhập `12.3456`, bấm **Đặt mẫu**. Hoặc gõ trên Serial Monitor: `CMD:SIM:ON` rồi `CMD:SIM:PUT:12.3456`.
4. Kết quả mong đợi:
   - Popup extension hiện `12.3456 g` kèm badge **MÔ PHỎNG**: "Chưa ổn định" khoảng 2 giây rồi chuyển "Ổn định".
   - Web nhận **đúng 1 lần** (`HR250A_onData` được gọi; nhãn có chữ `[MÔ PHỎNG]` nếu dùng snippet mẫu).
   - Bấm **Nhấc mẫu**: số về `0.0000`, **không** có popup 0 g trên web.
   - **Đặt mẫu** lại đúng số cũ: web nhận thêm 1 lần.
   - **Trừ bì** / **Về 0**: số về 0.
5. Test dài: **Tự động** lặp đặt/nhấc mẫu ngẫu nhiên để kiểm tra kết nối ổn định trong nhiều giờ.

Tắt bằng **Tắt mô phỏng** hoặc khởi động lại hộp. Khi mô phỏng đang bật, dữ liệu từ cân thật bị bỏ qua.

Không có cả hộp ESP32: chạy `node chrome-extension/tools/fake-device.mjs` trên máy tính và trỏ extension tới `127.0.0.1`.

---

## 7. Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Không nhận được gì từ cân | Đảo TX/RX | Đảo dây IO5 ↔ IO17 |
| Không nhận được gì từ cân | Cân không gửi | Gõ `Q` trong Serial Monitor, hoặc bấm **PRINT** trên cân, xem LED trên module có nháy không |
| Ký tự lạ, rác, không ra JSON | Sai baud hoặc parity | `CMD:RAW:ON` để xem hex; kiểm tra `2400` + `7E1`, đối chiếu mục `SIF` trên cân |
| Bấm PRINT có dữ liệu nhưng lệnh `Q` không phản hồi | Dây từ ESP32 tới cân (chân 3) chưa thông | Kiểm tra dây RXD (TTL) ↔ IO17 và chân 3 |
| Serial in `{"type":"error","code":"E02"...}` liên tục | Cân chưa ở chế độ cân (đang tắt màn hình, đang CAL) | Bật cân về màn hình cân |
| Không có dòng `ETH IP` | Chưa cắm dây mạng, hoặc switch không cấp DHCP | Kiểm tra đèn cổng RJ45; nếu mạng không có DHCP thì đặt IP tĩnh (mục 6.2, cách 2) |
| Extension báo không kết nối được | Sai IP, khác dải mạng, hoặc bị firewall chặn cổng 81 | `CMD:STATUS` xem IP; ping IP của hộp từ máy tính |
| Giá trị nhảy liên tục | Gió, rung, cửa kính mở | Đóng cửa lồng kính; web chỉ nhận giá trị khi `stable == true` |
| ESP32 reset liên tục | Nguồn yếu (cục sạc kém, dây dài/mảnh) | Dùng cục sạc 5V ≥ 1A, dây ngắn |
| ESP32 hỏng chân / nóng | Cấp VCC module bằng 5V, hoặc nối thẳng RS-232 | Luôn cấp module bằng **3V3** và luôn qua MAX3232 |

---

## 8. Ghi chú sử dụng cân

- Cân bằng máy bằng bọt thủy trước khi dùng.
- Cắm điện làm ấm cân khoảng 30 phút đến 1 giờ trước khi đo chính xác.
- Đặt cân trên bàn chắc chắn, tránh quạt, điều hòa và ánh nắng trực tiếp.
- Không đặt vật quá 252 g, không để mẫu nóng hoặc lạnh lên đĩa cân.
