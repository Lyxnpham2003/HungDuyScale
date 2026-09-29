// Delivers a payload to window.HR250A_onData in exactly one qlcl tab.

import { pickTargetTab, urlPatternsFor, TARGET_HOST } from "../lib/tab-picker.js";

export const WEB_CALLBACK = "HR250A_onData";

// Runs inside the page (MAIN world) — must be self-contained, it is serialized by executeScript.
export function pageCall(name, data) {
  const fn = window[name];
  if (typeof fn !== "function") {
    console.warn(`[HR250A] window.${name} chưa được khai báo trên trang này.`);
    return "no-handler";
  }
  try {
    fn(data);
    return "ok";
  } catch (e) {
    console.error(`[HR250A] window.${name} bị lỗi:`, e);
    return "error";
  }
}

// Returns notify(payload, hosts?) → { ok, tabId?, reason? }
// reason: "no-tab" | "no-handler" | "handler-error" | "inject-failed"
export function createNotifier({ tabs, windows, scripting, callbackName = WEB_CALLBACK }) {
  return async function notify(payload, hosts = [TARGET_HOST]) {
    let candidates = [];
    try {
      candidates = await tabs.query({ url: urlPatternsFor(hosts) });
    } catch {}
    let focusedWindowId;
    try {
      focusedWindowId = (await windows.getLastFocused()).id;
    } catch {}

    const tab = pickTargetTab(candidates, focusedWindowId, hosts);
    if (!tab) return { ok: false, reason: "no-tab" };

    try {
      const [res] = await scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: pageCall,
        args: [callbackName, payload],
      });
      if (res?.result === "no-handler") return { ok: false, reason: "no-handler", tabId: tab.id };
      if (res?.result === "error") return { ok: false, reason: "handler-error", tabId: tab.id };
      return { ok: true, tabId: tab.id };
    } catch {
      return { ok: false, reason: "inject-failed", tabId: tab.id };
    }
  };
}
