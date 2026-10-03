// Background logic: connection → parse → push gate → notifier → history.
// Chrome APIs are injected (see main.js) so this module is testable in Node.

import { DEFAULTS, normalizeConfig, deviceUrl, isIPv4 } from "../lib/config.js";
import { parseDeviceMessage, parseNetMessage, toWebPayload, DEVICE_NAME } from "../lib/reading.js";
import { createPushGate } from "../lib/push-gate.js";
import { addEntry } from "../lib/history.js";
import { logEntry, appendLog, logFromHistory } from "../lib/weigh-log.js";
import { REASON_TEXT, NET_ERROR_TEXT } from "../lib/messages.js";
import { targetHosts } from "../lib/tab-picker.js";
import { normalizePrefix, hostsIn, runPool } from "../lib/scan.js";
import { NET_INFO_COMMAND, NET_DHCP_COMMAND, validateStaticNet, netSetCommand } from "../lib/net-config.js";
import { createConnection, probeDevice, netRequest } from "./connection.js";

// Commands the popup/options may send to the gateway (firmware forwards Z/T to the balance)
const ALLOWED_COMMAND = /^(Z|T|CMD:SIM:[A-Z0-9.:+-]{1,24})$/;

const SCAN_LIMIT = 32;
const SCAN_TIMEOUT_MS = 1500;
const NET_REPLY_TIMEOUT_MS = 5000;
const REFIND_INTERVAL_MS = 2000;
const REFIND_TOTAL_MS = 40000;

export function createService({
  WebSocketImpl,
  storage, // { local, session } with get/set
  notifier, // async (payload) => { ok, tabId?, reason? }
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  now = () => new Date(),
  persistIntervalMs = 300,
}) {
  let config = { ...DEFAULTS };
  let gate = createPushGate(config);
  let history = [];
  let weighLog = [];
  let live = {
    status: "disconnected",
    error: null,
    deviceIp: "",
    lastReading: null,
    badMessages: 0,
    updatedAt: null,
  };
  let lastPersistAt = -Infinity;
  let persistTimer = null;

  const connection = createConnection({
    WebSocketImpl,
    getUrl: () => (config.deviceIp ? deviceUrl(config) : null),
    onMessage: (text) => {
      handleDeviceMessage(text).catch((e) => console.error("[HR250A]", e));
    },
    onStatus: (status, extra) => setLive({ status, error: extra?.error ?? null }, true),
    setTimeoutFn,
    clearTimeoutFn,
  });

  // ── Live state → chrome.storage.session (whole object, throttled) ──────────

  function flushLive() {
    if (persistTimer !== null) {
      clearTimeoutFn(persistTimer);
      persistTimer = null;
    }
    lastPersistAt = now().getTime();
    Promise.resolve(storage.session.set({ live })).catch(() => {});
  }

  function setLive(patch, immediate = false) {
    live = { ...live, ...patch, updatedAt: now().toISOString() };
    const elapsed = now().getTime() - lastPersistAt;
    if (immediate || elapsed >= persistIntervalMs) {
      flushLive();
    } else if (persistTimer === null) {
      persistTimer = setTimeoutFn(flushLive, persistIntervalMs - elapsed);
    }
  }

  // ── Config / history ────────────────────────────────────────────────────────

  async function loadConfig() {
    const raw = await storage.local.get({ ...DEFAULTS, history: [], weighLog: null });
    config = normalizeConfig(raw).config;
    history = Array.isArray(raw.history) ? raw.history : [];
    // No log yet (first run after the update): start it from the existing history.
    weighLog = Array.isArray(raw.weighLog) ? raw.weighLog : logFromHistory(history);
    gate = createPushGate(config);
    setLive({ deviceIp: config.deviceIp }, true);
  }

  function applyConnectionPolicy() {
    if (config.autoConnect && config.deviceIp) connection.start();
    else connection.stop();
  }

  // ── Network setup (CMD:NET:*) ───────────────────────────────────────────────

  function askBox(ip, wsPort, command, timeoutMs) {
    return netRequest({ WebSocketImpl, url: deviceUrl({ deviceIp: ip, wsPort }), command, timeoutMs, setTimeoutFn, clearTimeoutFn });
  }

  function toDevice(ip, wsPort, r) {
    if (r.ok && r.reply.device === DEVICE_NAME) {
      const setupLeftSec = Number(r.reply.setupLeftSec) || 0;
      return { ip, wsPort, id: String(r.reply.id ?? ""), mode: String(r.reply.mode ?? ""), setupLeftSec, fw: String(r.reply.fw ?? ""), legacy: false, canSetup: setupLeftSec > 0 };
    }
    if (r.legacy) return { ip, wsPort, id: r.id, mode: "", setupLeftSec: 0, fw: "", legacy: true, canSetup: false };
    return null;
  }

  function portOf(value) {
    const p = Number(value ?? config.wsPort);
    return Number.isInteger(p) && p >= 1 && p <= 65535 ? p : null;
  }

  async function saveDevice(ip, wsPort) {
    await storage.local.set({ deviceIp: ip, wsPort });
    await loadConfig();
    applyConnectionPolicy();
  }

  const sleep = (ms) => new Promise((resolve) => setTimeoutFn(resolve, ms));

  // After CMD:NET:SET the box restarts; poll the new address until the same MAC answers.
  // Each poll also writes progress to session storage: the UI shows it, and the extension
  // API call keeps the MV3 service worker from idling out during the up-to-40 s wait.
  async function refind(ip, wsPort, id) {
    const deadline = now().getTime() + REFIND_TOTAL_MS;
    while (now().getTime() < deadline) {
      setLive({ netSetup: { stage: "restarting", ip } }, true);
      const r = await askBox(ip, wsPort, NET_INFO_COMMAND, SCAN_TIMEOUT_MS);
      if (r.ok && r.reply.id === id) return true;
      await sleep(REFIND_INTERVAL_MS);
    }
    return false;
  }

  // ── Readings ────────────────────────────────────────────────────────────────

  async function deliver(payload, source) {
    const result = await notifier(payload, targetHosts(config));
    const at = now().toISOString();
    history = addEntry(history, {
      at,
      valueText: payload.valueText,
      unit: payload.unit,
      sim: !!payload.sim,
      ok: result.ok,
      reason: result.reason ?? null,
      source,
      payload,
    });
    weighLog = appendLog(
      weighLog,
      logEntry({ at, payload, result, source, deviceIp: config.deviceIp, deviceId: live.lastReading?.id ?? "" }),
    );
    await storage.local.set({ history, weighLog });
    return result;
  }

  async function handleDeviceMessage(text) {
    const reading = parseDeviceMessage(text, now());
    if (!reading) {
      if (!parseNetMessage(text)) setLive({ badMessages: live.badMessages + 1 });
      return;
    }
    setLive({ lastReading: reading });
    if (gate.decide(reading) === "push") await deliver(toWebPayload(reading), "auto");
  }

  // ── Messages from popup / options ───────────────────────────────────────────

  async function handleRuntimeMessage(msg = {}) {
    switch (msg.action) {
      case "getState":
        return { ok: true, live, config, history };

      case "getWeighLog":
        return { ok: true, entries: weighLog };

      case "clearWeighLog":
        weighLog = [];
        await storage.local.set({ weighLog });
        return { ok: true };

      case "connect":
        if (!config.deviceIp) return { ok: false, error: "Chưa cấu hình IP của hộp cân." };
        connection.start();
        return { ok: true };

      case "disconnect":
        connection.stop();
        return { ok: true };

      case "applySettings":
        await loadConfig();
        applyConnectionPolicy();
        return { ok: true };

      case "sendCommand": {
        const cmd = String(msg.cmd ?? "").trim().toUpperCase();
        if (!ALLOWED_COMMAND.test(cmd)) return { ok: false, error: `Lệnh "${msg.cmd}" không được phép.` };
        return connection.send(cmd) ? { ok: true } : { ok: false, error: "Chưa kết nối tới hộp cân." };
      }

      case "resend": {
        const last = history[0];
        if (!last) return { ok: false, error: "Chưa có lần gửi nào." };
        const result = await deliver(last.payload, "resend");
        return result.ok ? { ok: true } : { ok: false, error: REASON_TEXT[result.reason] ?? result.reason };
      }

      case "testConnection": {
        // save: true → msg carries the whole settings form; it is stored only if the probe succeeds
        const { config: c, errors } = normalizeConfig(
          msg.save
            ? msg
            : {
                ...config,
                deviceIp: msg.deviceIp,
                wsPort: msg.wsPort,
                connectTimeoutSec: msg.connectTimeoutSec ?? config.connectTimeoutSec,
              },
        );
        if (errors.length) return { ok: false, error: errors.join(" ") };
        const result = await probeDevice({
          WebSocketImpl,
          url: deviceUrl(c),
          timeoutMs: c.connectTimeoutSec * 1000,
          setTimeoutFn,
          clearTimeoutFn,
        });
        if (!result.ok || !msg.save) return result;
        await storage.local.set(c);
        await loadConfig();
        applyConnectionPolicy();
        return { ...result, saved: true };
      }

      case "scanNetwork": {
        const { prefix, error } = normalizePrefix(msg.prefix);
        if (error) return { ok: false, error };
        const wsPort = portOf(msg.wsPort);
        if (!wsPort) return { ok: false, error: "Port phải là số nguyên từ 1 đến 65535." };
        const hosts = hostsIn(prefix);
        setLive({ scan: { done: 0, total: hosts.length } }, true);
        const found = await runPool(
          hosts,
          SCAN_LIMIT,
          (ip) => askBox(ip, wsPort, NET_INFO_COMMAND, SCAN_TIMEOUT_MS).then((r) => toDevice(ip, wsPort, r)),
          (done, total) => setLive({ scan: { done, total } }),
        );
        setLive({ scan: null }, true);
        return { ok: true, devices: found.filter(Boolean) };
      }

      case "useDevice": {
        const wsPort = portOf(msg.wsPort);
        const { config: c, errors } = normalizeConfig({ ...config, deviceIp: msg.ip, wsPort });
        if (errors.length || !wsPort) return { ok: false, error: errors.join(" ") || "Port không hợp lệ." };
        const r = await askBox(c.deviceIp, c.wsPort, NET_INFO_COMMAND, c.connectTimeoutSec * 1000);
        if (!toDevice(c.deviceIp, c.wsPort, r)) return { ok: false, error: `Không thấy hộp cân ở ${c.deviceIp}:${c.wsPort}.` };
        await saveDevice(c.deviceIp, c.wsPort);
        return { ok: true, ip: c.deviceIp };
      }

      case "setDeviceNetwork": {
        const currentIp = String(msg.currentIp ?? "");
        const id = String(msg.id ?? "");
        const wsPort = portOf(msg.wsPort);
        if (!isIPv4(currentIp) || !id || !wsPort) return { ok: false, error: "Chọn hộp cân trong danh sách tìm thấy trước." };

        let net = null;
        let command = NET_DHCP_COMMAND;
        if (msg.mode !== "dhcp") {
          const v = validateStaticNet(msg);
          if (v.errors.length) return { ok: false, error: v.errors.join(" ") };
          net = v.net;
          command = netSetCommand(net);
        }

        try {
          setLive({ netSetup: { stage: "sending", ip: currentIp } }, true);
          const sent = await askBox(currentIp, wsPort, command, NET_REPLY_TIMEOUT_MS);
          if (!sent.ok) return { ok: false, error: `Không gửi được lệnh tới hộp ở ${currentIp} (hộp tắt, khác mạng, hoặc firmware cũ).` };
          if (!sent.reply.ok) return { ok: false, error: NET_ERROR_TEXT[sent.reply.error] ?? `Hộp từ chối: ${sent.reply.error}` };
          if (!net) return { ok: true, dhcp: true };

          setLive({ netSetup: { stage: "restarting", ip: net.ip } }, true);
          await sleep(Number(sent.reply.restartInMs) || 0);
          if (!(await refind(net.ip, wsPort, id))) {
            return {
              ok: false,
              error: `Hộp đã lưu IP ${net.ip} nhưng chưa thấy hộp ở IP này. Kiểm tra IP/gateway có đúng dải mạng không; hộp vẫn giữ IP mới.`,
            };
          }
          await saveDevice(net.ip, wsPort);
          return { ok: true, ip: net.ip, id };
        } finally {
          setLive({ netSetup: null }, true);
        }
      }

      default:
        return { ok: false, error: `Không hiểu yêu cầu "${msg.action}".` };
    }
  }

  return {
    async init() {
      await loadConfig();
      if (config.autoConnect && config.deviceIp) connection.start();
    },
    handleRuntimeMessage,
    keepalive: () => connection.ensure(),
  };
}
