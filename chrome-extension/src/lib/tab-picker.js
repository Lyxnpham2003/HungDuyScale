export const TARGET_HOST = "qlcl.hungduy.vn";
// Local dev of the QuanLyChatLuong web (e.g. https://localhost:7008), opt-in via Options
export const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

export function targetHosts({ allowLocalhost = false } = {}) {
  return allowLocalhost ? [TARGET_HOST, ...LOCAL_HOSTS] : [TARGET_HOST];
}

// Match patterns without a port match every port
export function urlPatternsFor(hosts) {
  return hosts.flatMap((h) => [`http://${h}/*`, `https://${h}/*`]);
}

export function isTargetTab(tab, hosts = [TARGET_HOST]) {
  try {
    return hosts.includes(new URL(tab.url).hostname);
  } catch {
    return false;
  }
}

// Exactly one tab receives the reading: the active target tab in the focused
// window, else an active target tab anywhere, else the most recently used one.
export function pickTargetTab(tabs, focusedWindowId, hosts = [TARGET_HOST]) {
  const candidates = (tabs || []).filter((t) => isTargetTab(t, hosts));
  if (candidates.length === 0) return null;
  return (
    candidates.find((t) => t.active && t.windowId === focusedWindowId) ??
    candidates.find((t) => t.active) ??
    candidates.reduce((best, t) => ((t.lastAccessed ?? 0) > (best.lastAccessed ?? 0) ? t : best))
  );
}
