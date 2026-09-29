// Single source of truth for settings (background, popup and options all import this).

export const DEFAULTS = Object.freeze({
  deviceIp: "",
  wsPort: 81,
  autoConnect: true,
  minWeight: 0.001, // g — readings at or below this count as "empty pan"
  connectTimeoutSec: 5,
  allowLocalhost: false, // also deliver to localhost / 127.0.0.1 (local dev of the web)
});

const IPV4_OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4 = new RegExp(`^${IPV4_OCTET}(\\.${IPV4_OCTET}){3}$`);
const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export function isIPv4(s) {
  return IPV4.test(String(s ?? ""));
}

// "ws://172.16.10.70:81/" → "172.16.10.70"
export function cleanHost(input) {
  return String(input ?? "")
    .trim()
    .replace(/^(https?|wss?):\/\//i, "")
    .replace(/[:/].*$/, "");
}

function isValidHost(host) {
  if (/^[\d.]+$/.test(host)) return IPV4.test(host);
  return HOSTNAME.test(host);
}

// Returns the cleaned config plus a list of Vietnamese error messages (empty = valid).
export function normalizeConfig(raw = {}) {
  const errors = [];

  const deviceIp = cleanHost(raw.deviceIp ?? DEFAULTS.deviceIp);
  if (!deviceIp) errors.push("Chưa nhập IP của hộp cân.");
  else if (!isValidHost(deviceIp)) errors.push(`IP "${deviceIp}" không hợp lệ.`);

  let wsPort = Number(raw.wsPort ?? DEFAULTS.wsPort);
  if (!Number.isInteger(wsPort) || wsPort < 1 || wsPort > 65535) {
    errors.push("Port phải là số nguyên từ 1 đến 65535.");
    wsPort = DEFAULTS.wsPort;
  }

  const rawMin = raw.minWeight ?? DEFAULTS.minWeight;
  let minWeight = String(rawMin).trim() === "" ? NaN : Number(rawMin); // Number("") would be 0
  if (!Number.isFinite(minWeight) || minWeight < 0) {
    errors.push("Ngưỡng tối thiểu phải là số ≥ 0.");
    minWeight = DEFAULTS.minWeight;
  }

  let connectTimeoutSec = Number(raw.connectTimeoutSec ?? DEFAULTS.connectTimeoutSec);
  if (!Number.isFinite(connectTimeoutSec)) connectTimeoutSec = DEFAULTS.connectTimeoutSec;
  connectTimeoutSec = Math.min(30, Math.max(2, Math.round(connectTimeoutSec)));

  const autoConnect = raw.autoConnect !== false;
  const allowLocalhost = raw.allowLocalhost === true;

  return { config: { deviceIp, wsPort, autoConnect, minWeight, connectTimeoutSec, allowLocalhost }, errors };
}

export function deviceUrl({ deviceIp, wsPort }) {
  return `ws://${deviceIp}:${wsPort}/`;
}
