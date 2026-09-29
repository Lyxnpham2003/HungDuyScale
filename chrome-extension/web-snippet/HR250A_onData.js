// ===== HR250A (Cân phân tích A&D HR-250A) =====
// Bản rút gọn. Bản đầy đủ (có HR250A_FIELDS, toast khi màn hình chưa có ô) ĐÃ ĐƯỢC THÊM vào
// QuanLyChatLuong/Views/Shared/_Layout.cshtml, ngay sau EK610i_onData. Sửa ở đó, không phải ở đây.
// Extension "Cân HR-250A" gọi hàm này MỘT LẦN mỗi khi cân ổn định với mẫu mới
// (đã lọc đĩa trống, số trùng, đơn vị khác g), nên phía web không cần debounce.
//
// data = {
//   device: "HR250A",
//   value: 12.34,          // số (có thể mất số 0 ở cuối)
//   valueText: "12.3400",  // chuỗi giữ đủ 4 số lẻ như màn hình cân → nên dùng cái này
//   unit: "g",
//   stable: true,
//   Status: "STABLE",
//   Date: "2026-09-24",    // giờ máy tính chạy extension
//   Time: "08:43:34",
//   sim: false             // true = số từ chế độ mô phỏng (chạy thử), không phải cân thật
// }

window.HR250A_onData = function (data) {
  if (!data) return;
  console.log("[HR250A] New reading:", data);

  var weight = data.valueText || (data.value !== undefined && data.value !== null ? String(data.value) : "");
  if (weight === "") return;

  var label = "Khối lượng (g)" + (data.sim ? " [MÔ PHỎNG]" : "");

  function byId(re) {
    return function ($row) {
      return $row.find("input").filter(function () { return re.test(this.id); }).first();
    };
  }

  // TODO(anh Trí): đổi regex cho đúng id của các ô nhận khối lượng trên form.
  // MeasureModal.push() tự bỏ các ô không có trong dòng đang sửa; nếu không ô nào
  // khớp thì popup sẽ không hiện.
  var candidates = [
    { key: "khoiLuong", label: "Khối lượng mẫu", match: byId(/^cboWeight\d*$/) },
  ];

  MeasureModal.push("HR250A", label, weight, MeasureModal_buildTimeString(data), candidates);
};
