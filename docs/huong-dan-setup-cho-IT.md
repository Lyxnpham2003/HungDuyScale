# Hướng dẫn cài đặt hộp cân HR-250A (dành cho IT nhà máy)

Không cần Serial Monitor. Chỉ cần: cân HR-250A, hộp cân (ESP32 WT32-ETH01), máy tính Windows có Chrome, và extension **Cân HR-250A**.

## Thông tin trên nhãn hộp

| Hộp | MAC | Hostname |
|---|---|---|
| #1 | `78:1C:3C:CA:2F:A7` | `hdscale-hr250a-CA2FA7` |

## 1. Cắm hộp
1. Cắm dây mạng từ hộp vào switch của nhà máy (mạng phải cấp IP tự động, DHCP).
2. Cắm nguồn 5V cho hộp. Từ lúc này có **10 phút** để đặt IP (xem mục 4). Hết 10 phút thì rút nguồn cắm lại.

## 2. Cài extension
1. Chrome → `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `chrome-extension`.
3. Ghim biểu tượng **Cân HR-250A** lên thanh công cụ.

## 3. Tìm hộp cân
1. Bấm biểu tượng extension → ⚙ (Cài đặt).
2. Mục **Cài đặt hộp cân lần đầu**: kiểm tra **Dải mạng** (3 số đầu IP của máy tính, ví dụ `172.16.10`), Port `81`.
3. Bấm **Tìm hộp cân**, đợi quét xong (khoảng 10 giây).
4. Đối chiếu **MAC** trong danh sách với nhãn trên hộp.

Chọn **một** trong hai cách dưới để giữ IP cố định cho hộp.

## 4a. Cách A: giữ IP trên router (khuyên dùng nếu IT quản lý router)
1. Trên router/DHCP server: giữ cố định (DHCP reservation) IP mong muốn cho MAC của hộp.
2. Rút nguồn hộp, cắm lại, đợi 10 giây.
3. Extension → **Tìm hộp cân** → dòng của hộp → **Dùng IP này**.

## 4b. Cách B: đặt IP tĩnh ngay trên hộp
1. Trong 10 phút đầu sau khi cắm nguồn: dòng của hộp → **Đặt IP cố định…**.
2. Nhập **IP mới** (phải trống, nằm ngoài dải router tự cấp), **Gateway**, Subnet mask (thường `255.255.255.0`), DNS (có thể bỏ trống).
3. Bấm **Lưu IP vào hộp**. Hộp khởi động lại; extension tự tìm hộp ở IP mới và lưu (tối đa 40 giây).
4. Sau khi đặt xong, hộp khóa việc đổi IP. Muốn đổi lại thì rút nguồn hộp, cắm lại, làm lại trong 10 phút.

## 5. Hoàn tất
1. **Ghi IP lên vỏ hộp.**
2. Popup extension hiện **Đã kết nối**, số cân hiện khi đặt mẫu lên cân.
3. Các máy tính khác dùng cân: cài extension → ⚙ → nhập IP ở mục **Kết nối hộp cân** → **Kiểm tra & lưu**.

## Xử lý sự cố
| Hiện tượng | Cách xử lý |
|---|---|
| Không tìm thấy hộp | Máy tính và hộp phải cùng dải mạng; kiểm tra đèn cổng mạng của hộp; đúng Dải mạng / Port 81 |
| "Hết 10 phút cài đặt" | Rút nguồn hộp, cắm lại, làm lại trong 10 phút |
| "Hộp đã lưu IP … nhưng chưa thấy hộp" | IP/gateway nhập sai dải. Rút nguồn cắm lại; nếu vẫn không tìm thấy, liên hệ bộ phận IoT (đặt lại qua cổng USB) |
| "firmware cũ, không đặt IP được" | Hộp chưa được nạp firmware 0.4.0: liên hệ bộ phận IoT |
