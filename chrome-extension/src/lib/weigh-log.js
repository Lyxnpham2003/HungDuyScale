// Weighing log: every delivery attempt (auto or resend, ok or failed), kept for CSV backup.
// Separate from `history` (20 entries for the popup) so a lost web save can be recovered.

export const LOG_MAX = 5000;

const pad = (n) => String(n).padStart(2, "0");

// Slim entry: no nested payload, so 5000 entries stay around 1 MB in chrome.storage.local.
export function logEntry({ at, payload, result, source, deviceIp = "", deviceId = "" }) {
  return {
    at,
    valueText: payload.valueText,
    unit: payload.unit,
    status: payload.Status,
    sim: !!payload.sim,
    source,
    ok: !!result.ok,
    reason: result.reason ?? null,
    deviceIp,
    deviceId,
  };
}

// Newest first; returns a new array.
export function appendLog(list, entry, max = LOG_MAX) {
  return [entry, ...(list || [])].slice(0, max);
}

// Seeds the log from an older `history` (before the log existed) so those entries are not lost.
export function logFromHistory(history) {
  return (Array.isArray(history) ? history : []).map((h) => ({
    at: h.at,
    valueText: h.valueText,
    unit: h.unit,
    status: h.payload?.Status ?? "",
    sim: !!h.sim,
    source: h.source,
    ok: !!h.ok,
    reason: h.reason ?? null,
    deviceIp: "",
    deviceId: "",
  }));
}

// ── CSV ───────────────────────────────────────────────────────────────────────

export const CSV_COLUMNS = [
  "Ngày",
  "Giờ",
  "Khối lượng",
  "Đơn vị",
  "Trạng thái",
  "Mô phỏng",
  "Nguồn",
  "Gửi vào web",
  "Lý do lỗi",
  "MAC hộp cân",
  "IP hộp cân",
  "Thời điểm (ISO)",
];

const NUMBER = /^-?\d+(\.\d+)?$/;

function cell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  // Stop Excel from running text as a formula; plain numbers such as "-0.0012" stay as they are.
  if (/^[=+\-@\t\r]/.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function localDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return ["", ""];
  return [
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  ];
}

// entries: newest first (as stored). The CSV is oldest first, like a logbook.
// reasonText: map of failure reason → label (messages.js REASON_TEXT).
export function toCsv(entries, reasonText = {}) {
  const rows = [CSV_COLUMNS];
  for (const e of [...(entries || [])].reverse()) {
    const [date, time] = localDateTime(e.at);
    rows.push([
      date,
      time,
      e.valueText,
      e.unit,
      e.status,
      e.sim ? "Có" : "",
      e.source === "resend" ? "Gửi lại" : "Tự động",
      e.ok ? "Đã gửi" : "Lỗi",
      e.ok ? "" : (reasonText[e.reason] ?? e.reason ?? ""),
      e.deviceId,
      e.deviceIp,
      e.at,
    ]);
  }
  // BOM so Excel opens UTF-8 (Vietnamese) correctly; CRLF per RFC 4180.
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function csvFileName(date = new Date()) {
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `lich-su-can-HR250A-${d}-${t}.csv`;
}
