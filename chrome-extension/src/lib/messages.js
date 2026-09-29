// Vietnamese labels shared by background, popup and options.

export const STATUS_TEXT = {
  connecting: "Đang kết nối…",
  connected: "Đã kết nối",
  reconnecting: "Mất kết nối, đang thử lại…",
  disconnected: "Chưa kết nối",
};

export const READING_STATUS_TEXT = {
  STABLE: "Ổn định",
  UNSTABLE: "Chưa ổn định",
  OVERLOAD: "Quá tải",
  COUNT: "Chế độ đếm",
};

export const REASON_TEXT = {
  "no-tab": "Không có tab web QLCL nào đang mở.",
  "no-handler": "Trang chưa khai báo window.HR250A_onData.",
  "handler-error": "Hàm window.HR250A_onData trên trang bị lỗi (xem Console).",
  "inject-failed": "Không chèn được script vào tab (trang đang tải hoặc bị chặn).",
};

export const NET_ERROR_TEXT = {
  "setup-closed": "Hết 10 phút cài đặt. Rút điện, cắm lại hộp rồi làm lại trong 10 phút.",
  "bad-args": "Hộp không nhận thông số IP (sai định dạng).",
};
