import { DEFAULTS, normalizeConfig } from "../lib/config.js";
import { DEFAULT_PREFIX, prefixOf } from "../lib/scan.js";
import { formatMac } from "../lib/net-config.js";
import { toCsv, csvFileName, LOG_MAX } from "../lib/weigh-log.js";
import { REASON_TEXT } from "../lib/messages.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function readForm() {
  return {
    deviceIp: $("deviceIp").value,
    wsPort: $("wsPort").value,
    connectTimeoutSec: $("connectTimeoutSec").value,
    autoConnect: $("autoConnect").checked,
    minWeight: $("minWeight").value,
    allowLocalhost: $("allowLocalhost").checked,
  };
}

function fillForm(cfg) {
  $("deviceIp").value = cfg.deviceIp;
  $("wsPort").value = cfg.wsPort;
  $("connectTimeoutSec").value = cfg.connectTimeoutSec;
  $("autoConnect").checked = cfg.autoConnect;
  $("minWeight").value = cfg.minWeight;
  $("allowLocalhost").checked = cfg.allowLocalhost;
}

function show(boxId, ok, text) {
  const box = $(boxId);
  box.textContent = text;
  box.className = `notice ${ok ? "notice-ok" : "notice-err"}`;
}

// ── Save ──────────────────────────────────────────────────────────────────────

$("saveBtn").addEventListener("click", async () => {
  const { config, errors } = normalizeConfig(readForm());
  if (errors.length) {
    show("formResult", false, errors.join(" "));
    return;
  }
  $("saveBtn").disabled = true;
  try {
    await chrome.storage.local.set(config);
    await send({ action: "applySettings" });
    fillForm(config);
    show("formResult", true, "Đã lưu cài đặt.");
  } finally {
    $("saveBtn").disabled = false;
  }
});

// ── Test connection (saves the form only if the device answers) ───────────────

$("testBtn").addEventListener("click", async () => {
  const form = readForm();
  const btn = $("testBtn");
  btn.disabled = true;
  btn.textContent = "Đang kiểm tra…";
  try {
    const res = await send({ action: "testConnection", save: true, ...form });
    if (res.ok) {
      const r = res.reading;
      fillForm(normalizeConfig(form).config);
      show(
        "formResult",
        true,
        `Kết nối được và đã lưu cài đặt. Số cân hiện tại: ${r.valueText || "–"} ${r.unit}${r.sim ? " (mô phỏng)" : ""}.`,
      );
    } else {
      show("formResult", false, `${res.error} Cài đặt chưa được lưu.`);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Kiểm tra & lưu";
  }
});

// ── Simulation panel ──────────────────────────────────────────────────────────

async function simCommand(cmd) {
  const res = await send({ action: "sendCommand", cmd });
  show("simResult", res.ok, res.ok ? `Đã gửi: ${cmd}` : res.error);
}

document.querySelectorAll("[data-cmd]").forEach((btn) => {
  btn.addEventListener("click", () => simCommand(btn.dataset.cmd));
});

$("simPutBtn").addEventListener("click", () => {
  const g = Number($("simWeight").value);
  if (!Number.isFinite(g) || g < 0 || g > 252) {
    show("simResult", false, "Khối lượng mô phỏng phải từ 0 đến 252 g.");
    return;
  }
  simCommand(`CMD:SIM:PUT:${g.toFixed(4)}`);
});

// ── First-time setup: scan, adopt IP, set static IP ───────────────────────────

let selected = null;

function reloadForm() {
  return chrome.storage.local.get(DEFAULTS).then((raw) => fillForm(normalizeConfig(raw).config));
}

function setupText(d) {
  if (d.legacy) return "firmware cũ, không đặt IP được";
  if (!d.canSetup) return "hết 10 phút cài đặt";
  return `còn ${Math.ceil(d.setupLeftSec / 60)} phút cài đặt`;
}

function renderDevices(devices) {
  const list = $("deviceList");
  list.replaceChildren();
  for (const d of devices) {
    const li = document.createElement("li");
    const ip = document.createElement("span");
    ip.className = "ip";
    ip.textContent = d.ip;
    const info = document.createElement("span");
    info.className = "muted";
    info.textContent = `MAC ${formatMac(d.id)} · ${d.mode === "static" ? "IP tĩnh" : d.mode === "dhcp" ? "DHCP" : "?"} · ${setupText(d)}`;
    const spacer = document.createElement("span");
    spacer.className = "spacer";

    const use = document.createElement("button");
    use.className = "btn";
    use.textContent = "Dùng IP này";
    use.addEventListener("click", () => useDevice(d, use));

    const set = document.createElement("button");
    set.className = "btn btn-primary";
    set.textContent = "Đặt IP cố định…";
    set.disabled = !d.canSetup;
    set.title = d.canSetup ? "" : setupText(d);
    set.addEventListener("click", () => openNetForm(d));

    li.append(ip, info, spacer, use, set);
    list.append(li);
  }
}

$("scanBtn").addEventListener("click", async () => {
  const btn = $("scanBtn");
  btn.disabled = true;
  $("scanResult").classList.add("hidden");
  $("deviceList").replaceChildren();
  $("scanProgress").textContent = "Đang quét…";
  try {
    const res = await send({ action: "scanNetwork", prefix: $("scanPrefix").value, wsPort: $("scanPort").value });
    if (!res.ok) return show("scanResult", false, res.error);
    renderDevices(res.devices);
    if (res.devices.length === 0) {
      show(
        "scanResult",
        false,
        `Không tìm thấy hộp cân nào trong dải ${$("scanPrefix").value.trim()}.1–254. Máy tính và hộp phải cùng mạng; hoặc nhập IP tay ở mục Kết nối hộp cân.`,
      );
    }
  } catch {
    show("scanResult", false, "Mất kết nối với extension giữa chừng. Bấm Tìm hộp cân lần nữa.");
  } finally {
    btn.disabled = false;
    $("scanProgress").textContent = "";
  }
});

// The background answers after the whole operation; if its service worker restarts
// mid-way the message port closes and sendMessage rejects.
const LOST_BACKGROUND = "Mất kết nối với extension giữa chừng. Bấm Tìm hộp cân để kiểm tra hộp đã nhận IP mới chưa.";

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.live) return;
  const scan = changes.live.newValue?.scan;
  if (scan) $("scanProgress").textContent = `Đang quét… ${scan.done}/${scan.total}`;
  const step = changes.live.newValue?.netSetup;
  if (step?.stage === "sending") show("netResult", true, `Đang gửi lệnh tới hộp ở ${step.ip}…`);
  if (step?.stage === "restarting") show("netResult", true, `Hộp đang khởi động lại, đang tìm hộp ở ${step.ip}… (tối đa 40 giây)`);
});

async function useDevice(d, btn) {
  btn.disabled = true;
  try {
    const res = await send({ action: "useDevice", ip: d.ip, wsPort: d.wsPort });
    show("scanResult", res.ok, res.ok ? `Đã lưu IP ${res.ip} và đang kết nối. Ghi IP này lên vỏ hộp.` : res.error);
    if (res.ok) await reloadForm();
  } catch {
    show("scanResult", false, LOST_BACKGROUND);
  } finally {
    btn.disabled = false;
  }
}

function openNetForm(d) {
  selected = d;
  $("netTarget").textContent = `(${d.ip}, MAC ${formatMac(d.id)})`;
  $("netIp").value = d.ip;
  $("netGw").value = "";
  $("netGw").placeholder = `${prefixOf(d.ip) ?? DEFAULT_PREFIX}.1`;
  $("netResult").classList.add("hidden");
  $("netForm").classList.remove("hidden");
  $("netGw").focus();
}

async function sendNet(mode) {
  if (!selected) return;
  const buttons = ["netSaveBtn", "netDhcpBtn", "netCloseBtn"].map($);
  buttons.forEach((b) => (b.disabled = true));
  show("netResult", true, mode === "dhcp" ? "Đang gửi lệnh…" : "Đang gửi… hộp sẽ khởi động lại, đợi tối đa 40 giây.");
  try {
    const res = await send({
      action: "setDeviceNetwork",
      mode,
      currentIp: selected.ip,
      wsPort: selected.wsPort,
      id: selected.id,
      ip: $("netIp").value,
      gw: $("netGw").value,
      mask: $("netMask").value,
      dns: $("netDns").value,
    });
    if (!res.ok) return show("netResult", false, res.error);
    if (res.dhcp) {
      show("netResult", true, "Hộp đang khởi động lại với DHCP. Đợi khoảng 10 giây rồi bấm Tìm hộp cân.");
    } else {
      show("netResult", true, `Đã đặt IP ${res.ip} cho hộp và lưu vào extension. Ghi IP này lên vỏ hộp.`);
      await reloadForm();
    }
  } catch {
    show("netResult", false, LOST_BACKGROUND);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

$("netSaveBtn").addEventListener("click", () => sendNet("static"));
$("netDhcpBtn").addEventListener("click", () => sendNet("dhcp"));
$("netCloseBtn").addEventListener("click", () => {
  selected = null;
  $("netForm").classList.add("hidden");
});

// ── Weighing log: CSV export / clear ──────────────────────────────────────────

function renderLogSummary(entries) {
  const box = $("logSummary");
  if (!entries.length) {
    box.textContent = "Chưa có lần cân nào được ghi.";
    return;
  }
  const when = (iso) => new Date(iso).toLocaleString("vi-VN", { hour12: false });
  const failed = entries.filter((e) => !e.ok).length;
  box.textContent =
    `${entries.length} lần cân, từ ${when(entries[entries.length - 1].at)} đến ${when(entries[0].at)}` +
    (failed ? ` · ${failed} lần gửi vào web bị lỗi` : "");
}

async function loadLog() {
  const res = await send({ action: "getWeighLog" });
  const entries = res.ok ? res.entries : [];
  renderLogSummary(entries);
  return entries;
}

function downloadCsv(text, fileName) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

$("exportBtn").addEventListener("click", async () => {
  const btn = $("exportBtn");
  btn.disabled = true;
  try {
    const entries = await loadLog();
    if (!entries.length) return show("logResult", false, "Chưa có lần cân nào để xuất.");
    const name = csvFileName();
    downloadCsv(toCsv(entries, REASON_TEXT), name);
    show("logResult", true, `Đã xuất ${entries.length} lần cân ra file ${name} (thư mục Tải xuống).`);
  } catch {
    show("logResult", false, "Không xuất được CSV. Tải lại trang Cài đặt rồi thử lại.");
  } finally {
    btn.disabled = false;
  }
});

function setClearConfirm(on) {
  $("clearLogBtn").classList.toggle("hidden", on);
  $("clearLogConfirmBtn").classList.toggle("hidden", !on);
  $("clearLogCancelBtn").classList.toggle("hidden", !on);
}

$("clearLogBtn").addEventListener("click", () => {
  setClearConfirm(true);
  const box = $("logResult");
  box.textContent = "Xoá toàn bộ lịch sử cân trên máy này? Không khôi phục được. Hãy Xuất CSV trước nếu chưa xuất.";
  box.className = "notice notice-warn";
});
$("clearLogCancelBtn").addEventListener("click", () => {
  setClearConfirm(false);
  $("logResult").classList.add("hidden");
});
$("clearLogConfirmBtn").addEventListener("click", async () => {
  setClearConfirm(false);
  const res = await send({ action: "clearWeighLog" });
  show("logResult", res.ok, res.ok ? "Đã xoá lịch sử cân." : res.error);
  await loadLog();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.weighLog) renderLogSummary(changes.weighLog.newValue ?? []);
});

// ── Init ──────────────────────────────────────────────────────────────────────

$("logMax").textContent = LOG_MAX;
loadLog();

chrome.storage.local.get(DEFAULTS).then((raw) => {
  const { config } = normalizeConfig(raw);
  fillForm(config);
  $("scanPrefix").value = prefixOf(config.deviceIp) ?? DEFAULT_PREFIX;
  $("scanPort").value = config.wsPort;
});
