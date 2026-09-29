// Static-IP input checks and CMD:NET:* command strings for the box's network setup.
// Everything is checked here before a command is sent: a wrong gateway would leave
// the box unreachable at its new address.

import { isIPv4 } from "./config.js";

export const NET_INFO_COMMAND = "CMD:NET:INFO";
export const NET_DHCP_COMMAND = "CMD:NET:DHCP";
export const DEFAULT_MASK = "255.255.255.0";

const toInt = (ip) => ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0) >>> 0;

// Contiguous ones, and at least 2 usable host bits (/30 or larger network)
function isValidMask(mask) {
  if (!isIPv4(mask)) return false;
  const host = ~toInt(mask) >>> 0;
  return host >= 3 && ((host + 1) & host) === 0;
}

export function validateStaticNet({ ip, gw, mask, dns } = {}) {
  const net = {
    ip: String(ip ?? "").trim(),
    gw: String(gw ?? "").trim(),
    mask: String(mask ?? "").trim() || DEFAULT_MASK,
    dns: String(dns ?? "").trim(),
  };
  const errors = [];
  if (!isIPv4(net.ip)) errors.push(`IP "${net.ip}" không hợp lệ.`);
  if (!isIPv4(net.gw)) errors.push(`Gateway "${net.gw}" không hợp lệ.`);
  if (!isValidMask(net.mask)) errors.push(`Subnet mask "${net.mask}" không hợp lệ (ví dụ 255.255.255.0).`);
  if (net.dns && !isIPv4(net.dns)) errors.push(`DNS "${net.dns}" không hợp lệ.`);
  if (errors.length) return { net, errors };

  const m = toInt(net.mask);
  const host = ~m >>> 0;
  const ipInt = toInt(net.ip);
  if (net.ip === net.gw) errors.push("IP của hộp không được trùng gateway.");
  else if ((ipInt & m) >>> 0 !== (toInt(net.gw) & m) >>> 0) errors.push("IP và gateway phải cùng dải mạng (theo subnet mask).");
  else if ((ipInt & host) === 0 || (ipInt & host) >>> 0 === host) errors.push(`IP "${net.ip}" là địa chỉ mạng/broadcast, chọn IP khác.`);
  return { net, errors };
}

export function netSetCommand({ ip, gw, mask, dns }) {
  return `CMD:NET:SET:${ip},${gw},${mask}${dns ? `,${dns}` : ""}`;
}

// "781C3CCA2FA7" → "78:1C:3C:CA:2F:A7" (the form IT and routers use)
export function formatMac(id) {
  return (String(id ?? "").match(/.{1,2}/g) ?? []).join(":");
}
