// Service worker entry: binds Chrome APIs to the testable service.
// Listeners are registered synchronously at top level (MV3 requirement).

import { createService } from "./service.js";
import { createNotifier } from "./notifier.js";

const KEEPALIVE_ALARM = "keepalive";

const service = createService({
  WebSocketImpl: WebSocket,
  storage: chrome.storage,
  notifier: createNotifier({ tabs: chrome.tabs, windows: chrome.windows, scripting: chrome.scripting }),
});
const ready = service.init();

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ready
    .then(() => service.handleRuntimeMessage(msg))
    .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true; // async response
});

// Backstop: if the worker was suspended or a retry got lost, reopen the socket.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) ready.then(() => service.keepalive());
});

chrome.alarms.get(KEEPALIVE_ALARM).then((existing) => {
  if (!existing) chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
});
