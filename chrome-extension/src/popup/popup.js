import { STATUS_TEXT, READING_STATUS_TEXT, REASON_TEXT } from "../lib/messages.js";
import { formatMac } from "../lib/net-config.js";

const $ = (id) => document.getElementById(id);

let live = null;
let config = null;
let history = [];

const send = (msg) => chrome.runtime.sendMessage(msg);

function timeOf(iso) {
  return iso ? new Date(iso).toLocaleTimeString("vi-VN", { hour12: false }) : "";
}

function showResult(res, okText) {
  const box = $("actionResult");
  box.textContent = res.ok ? okText : res.error || "Có lỗi xảy ra.";
  box.className = `notice ${res.ok ? "notice-ok" : "notice-err"}`;
  clearTimeout(showResult.timer);
  showResult.timer = setTimeout(() => box.classList.add("hidden"), 3000);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderLive() {
  const status = live?.status ?? "disconnected";
  $("statusDot").className = `dot ${status}`;
  $("statusText").textContent = STATUS_TEXT[status] ?? status;

  const hasIp = !!config?.deviceIp;
  $("setupCard").classList.toggle("hidden", hasIp);
  const r = live?.lastReading;
  $("deviceAddr").textContent = hasIp ? `${config.deviceIp}:${config.wsPort}${r?.id ? ` · MAC ${formatMac(r.id)}` : ""}` : "Chưa có IP";

  $("weightValue").textContent = r ? (r.status === "OVERLOAD" ? "Quá tải" : r.valueText || "–") : "–";
  $("weightUnit").textContent = r && r.status !== "OVERLOAD" ? r.unit : "";
  $("readingStatus").textContent = r ? READING_STATUS_TEXT[r.status] ?? r.status : "–";
  $("readingStatus").className = `badge ${r?.status === "STABLE" ? "badge-ok" : r ? "badge-warn" : ""}`;
  $("updatedAt").textContent = r ? `Lúc ${r.Time}` : "";
  $("simBadge").classList.toggle("hidden", !r?.sim);

  const warning = $("warning");
  if (r && r.status !== "OVERLOAD" && r.unit && r.unit !== "g") {
    warning.textContent = `Cân đang ở đơn vị "${r.unit}". Chỉ gửi vào web khi cân ở đơn vị g.`;
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }

  const offline = hasIp && status === "disconnected";
  $("connectRow").classList.toggle("hidden", !offline);
  $("connectError").textContent = live?.error ?? "";

  const connected = status === "connected";
  $("zeroBtn").disabled = !connected;
  $("tareBtn").disabled = !connected;

  const bad = live?.badMessages ?? 0;
  $("badMessages").textContent = `${bad} message lỗi`;
  $("badMessages").classList.toggle("hidden", bad === 0);
}

function renderHistory() {
  const list = $("historyList");
  list.replaceChildren();
  $("historyEmpty").classList.toggle("hidden", history.length > 0);
  $("resendBtn").disabled = history.length === 0;

  for (const e of history) {
    const li = document.createElement("li");

    const time = document.createElement("span");
    time.className = "time";
    time.textContent = timeOf(e.at);

    const value = document.createElement("span");
    value.className = "value";
    value.textContent = `${e.valueText} ${e.unit}`;

    li.append(time, value);

    if (e.sim) li.append(badge("MP", "badge-sim", "Số cân mô phỏng"));
    if (e.source === "resend") li.append(badge("gửi lại", "", "Gửi lại thủ công"));
    li.append(
      e.ok
        ? badge("✓ đã gửi", "badge-ok", "")
        : badge("✗ lỗi", "badge-err", REASON_TEXT[e.reason] ?? e.reason ?? ""),
    );
    list.append(li);
  }
}

function badge(text, cls, title) {
  const b = document.createElement("span");
  b.className = `badge ${cls}`;
  b.textContent = text;
  if (title) b.title = title;
  return b;
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function command(cmd, okText) {
  showResult(await send({ action: "sendCommand", cmd }), okText);
}

$("zeroBtn").addEventListener("click", () => command("Z", "Đã gửi lệnh về 0."));
$("tareBtn").addEventListener("click", () => command("T", "Đã gửi lệnh trừ bì."));
$("resendBtn").addEventListener("click", async () => {
  showResult(await send({ action: "resend" }), "Đã gửi lại vào web.");
});
$("connectBtn").addEventListener("click", async () => {
  const res = await send({ action: "connect" });
  if (!res.ok) showResult(res, "");
});
$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("openSettingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
// The download runs from the options tab: a popup closes as soon as it loses focus (e.g. a Save As dialog).
$("exportBtn").addEventListener("click", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("src/options/options.html#history") }),
);

// ── Live updates ──────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.live) {
    live = changes.live.newValue;
    renderLive();
  }
  if (area === "local" && changes.history) {
    history = changes.history.newValue ?? [];
    renderHistory();
  }
});

(async function init() {
  const state = await send({ action: "getState" });
  live = state.live;
  config = state.config;
  history = state.history ?? [];
  renderLive();
  renderHistory();
})();
