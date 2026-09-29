import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createService } from "../src/background/service.js";
import { FakeWebSocket, createFakeTimers, createFakeStorageArea, flush } from "./helpers.js";

function reading(header, value, extra = {}) {
  const v = value === null ? null : value.toFixed(4);
  return JSON.stringify({
    type: "reading", header,
    stable: header === "ST", unstable: header === "US", overload: header === "OL", counting: false,
    value: v === null ? null : Number(v), unit: "g", weight: v === null ? "" : `${v} g`, ...extra,
  });
}

async function setup({ stored = { deviceIp: "10.0.0.5" }, notifyResult = { ok: true, tabId: 7 } } = {}) {
  FakeWebSocket.reset();
  const timers = createFakeTimers();
  const storage = { local: createFakeStorageArea(stored), session: createFakeStorageArea() };
  const notified = [];
  const hostsSeen = [];
  const notifier = async (payload, hosts) => {
    notified.push(payload);
    hostsSeen.push(hosts);
    return typeof notifyResult === "function" ? notifyResult(payload) : notifyResult;
  };
  let clock = new Date(2026, 8, 24, 9, 0, 0).getTime();
  const service = createService({
    WebSocketImpl: FakeWebSocket,
    storage,
    notifier,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
    now: () => new Date(clock),
  });
  await service.init();
  return {
    service, storage, notified, hostsSeen, timers,
    advance: (ms) => { clock += ms; timers.tick(ms); },
    ws: () => FakeWebSocket.last,
  };
}

async function feed(ws, ...msgs) {
  for (const m of msgs) {
    ws.receive(m);
    await flush();
  }
}

describe("service", () => {
  beforeEach(() => FakeWebSocket.reset());

  test("auto-connects on init when an IP is configured", async () => {
    const { ws, storage, advance } = await setup();
    assert.equal(ws().url, "ws://10.0.0.5:81/");
    ws().open();
    advance(0);
    await flush();
    assert.equal(storage.session.data.live.status, "connected");
  });

  test("does not connect without an IP, or when autoConnect is off", async () => {
    await setup({ stored: {} });
    assert.equal(FakeWebSocket.instances.length, 0);
    await setup({ stored: { deviceIp: "10.0.0.5", autoConnect: false } });
    assert.equal(FakeWebSocket.instances.length, 0);
  });

  test("the headline scenario: notifies exactly twice, never for 0 g", async () => {
    const { ws, notified } = await setup();
    ws().open();
    await feed(ws(),
      reading("US", 5.1),
      reading("ST", 5.1234),
      reading("ST", 5.1234),
      reading("US", 5.1234),
      reading("ST", 5.1234),
      reading("ST", 0),
      reading("ST", 5.1234),
    );
    assert.equal(notified.length, 2);
    assert.deepEqual(notified.map((p) => p.valueText), ["5.1234", "5.1234"]);
    assert.equal(notified[0].device, "HR250A");
    assert.equal(notified[0].Status, "STABLE");
  });

  test("passes the target hosts from config (localhost only when allowed)", async () => {
    const a = await setup();
    a.ws().open();
    await feed(a.ws(), reading("ST", 1));
    assert.deepEqual(a.hostsSeen[0], ["qlcl.hungduy.vn"]);

    const b = await setup({ stored: { deviceIp: "10.0.0.5", allowLocalhost: true } });
    b.ws().open();
    await feed(b.ws(), reading("ST", 1));
    assert.deepEqual(b.hostsSeen[0], ["qlcl.hungduy.vn", "localhost", "127.0.0.1"]);
  });

  test("records every push in history (newest first) with the result", async () => {
    let n = 0;
    const { ws, storage } = await setup({
      notifyResult: () => (++n === 1 ? { ok: true, tabId: 7 } : { ok: false, reason: "no-tab" }),
    });
    ws().open();
    await feed(ws(), reading("ST", 1.5), reading("ST", 0), reading("ST", 2.5, { sim: true }));
    const h = storage.local.data.history;
    assert.equal(h.length, 2);
    assert.equal(h[0].valueText, "2.5000");
    assert.equal(h[0].ok, false);
    assert.equal(h[0].reason, "no-tab");
    assert.equal(h[0].sim, true);
    assert.equal(h[0].source, "auto");
    assert.equal(h[1].ok, true);
  });

  test("counts bad messages instead of treating them as readings", async () => {
    const { ws, notified, storage, advance } = await setup();
    ws().open();
    await feed(ws(), "garbage", JSON.stringify({ type: "error", code: "E02" }));
    advance(1000);
    await flush();
    assert.equal(notified.length, 0);
    assert.equal(storage.session.data.live.badMessages, 2);
  });

  test("throttles live-state writes but flushes the latest reading", async () => {
    const { ws, storage, advance } = await setup();
    ws().open();
    advance(1000);
    await flush();
    await feed(ws(), reading("US", 1), reading("US", 2), reading("US", 3));
    advance(300);
    await flush();
    assert.equal(storage.session.data.live.lastReading.valueText, "3.0000");
  });

  test("resend re-delivers the latest history entry, bypassing the gate", async () => {
    const { ws, service, notified, storage } = await setup();
    ws().open();
    await feed(ws(), reading("ST", 4.2));
    const res = await service.handleRuntimeMessage({ action: "resend" });
    assert.equal(res.ok, true);
    assert.equal(notified.length, 2);
    assert.equal(notified[1].valueText, "4.2000");
    assert.equal(storage.local.data.history[0].source, "resend");
  });

  test("resend with empty history fails politely", async () => {
    const { service } = await setup();
    const res = await service.handleRuntimeMessage({ action: "resend" });
    assert.equal(res.ok, false);
  });

  test("sendCommand forwards only whitelisted commands and needs a connection", async () => {
    const { ws, service } = await setup();
    assert.equal((await service.handleRuntimeMessage({ action: "sendCommand", cmd: "Z" })).ok, false);
    ws().open();
    assert.equal((await service.handleRuntimeMessage({ action: "sendCommand", cmd: "Z" })).ok, true);
    assert.equal((await service.handleRuntimeMessage({ action: "sendCommand", cmd: "t" })).ok, true);
    assert.equal((await service.handleRuntimeMessage({ action: "sendCommand", cmd: "CMD:SIM:PUT:12.5" })).ok, true);
    assert.equal((await service.handleRuntimeMessage({ action: "sendCommand", cmd: "CMD:IP:DHCP" })).ok, false);
    assert.equal((await service.handleRuntimeMessage({ action: "sendCommand", cmd: "CAL" })).ok, false);
    assert.deepEqual(ws().sent, ["Z", "T", "CMD:SIM:PUT:12.5"]);
  });

  test("applySettings reloads config, resets the gate and reconnects", async () => {
    const { ws, service, storage, notified } = await setup();
    ws().open();
    await feed(ws(), reading("ST", 3));
    storage.local.data.deviceIp = "10.0.0.9";
    await service.handleRuntimeMessage({ action: "applySettings" });
    assert.equal(ws().url, "ws://10.0.0.9:81/");
    ws().open();
    await feed(ws(), reading("ST", 3)); // gate was reset → same value pushes again
    assert.equal(notified.length, 2);
  });

  test("applySettings with autoConnect off disconnects", async () => {
    const { ws, service, storage, advance } = await setup();
    ws().open();
    storage.local.data.autoConnect = false;
    await service.handleRuntimeMessage({ action: "applySettings" });
    advance(60000);
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(storage.session.data.live.status, "disconnected");
  });

  test("testConnection validates input and does not save it", async () => {
    const { service, storage } = await setup();
    const bad = await service.handleRuntimeMessage({ action: "testConnection", deviceIp: "999.1.1.1", wsPort: 81 });
    assert.equal(bad.ok, false);
    const p = service.handleRuntimeMessage({ action: "testConnection", deviceIp: "10.0.0.77", wsPort: 82 });
    const probe = FakeWebSocket.last;
    assert.equal(probe.url, "ws://10.0.0.77:82/");
    probe.open();
    probe.receive(reading("ST", 1));
    assert.equal((await p).ok, true);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("testConnection with save stores the whole form and reconnects on success", async () => {
    const { service, storage } = await setup();
    const p = service.handleRuntimeMessage({
      action: "testConnection", save: true,
      deviceIp: "ws://10.0.0.77", wsPort: "82", connectTimeoutSec: "5", autoConnect: true, minWeight: "0.01", allowLocalhost: false,
    });
    const probe = FakeWebSocket.last;
    probe.open();
    probe.receive(reading("ST", 1));
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.saved, true);
    assert.equal(storage.local.data.deviceIp, "10.0.0.77");
    assert.equal(storage.local.data.wsPort, 82);
    assert.equal(storage.local.data.minWeight, 0.01);
    assert.equal(FakeWebSocket.last.url, "ws://10.0.0.77:82/"); // live connection moved to the new IP
  });

  test("testConnection with save stores nothing when the device is unreachable", async () => {
    const { service, storage } = await setup();
    const p = service.handleRuntimeMessage({ action: "testConnection", save: true, deviceIp: "10.0.0.77", wsPort: 81 });
    FakeWebSocket.last.fail();
    const res = await p;
    assert.equal(res.ok, false);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("testConnection with save rejects an invalid form before probing", async () => {
    const { service } = await setup();
    const before = FakeWebSocket.instances.length;
    const res = await service.handleRuntimeMessage({ action: "testConnection", save: true, deviceIp: "10.0.0.77", wsPort: 81, minWeight: "" });
    assert.equal(res.ok, false);
    assert.equal(FakeWebSocket.instances.length, before);
  });

  test("net replies on the live socket are not counted as bad messages", async () => {
    const { ws, storage, advance } = await setup();
    ws().open();
    await feed(ws(), JSON.stringify({ type: "net", ok: true, device: "HR250A", id: "AABB" }), "garbage");
    advance(1000);
    await flush();
    assert.equal(storage.session.data.live.badMessages, 1);
  });

  const netInfo = (extra = {}) =>
    JSON.stringify({ type: "net", ok: true, device: "HR250A", id: "AABBCCDDEEFF", ip: "10.0.0.7", mode: "dhcp", setupLeftSec: 420, fw: "0.4.0", ...extra });

  // Runs start(), then answers each socket it opens with handlers[url] (or fails it)
  // until the returned promise settles. Sockets are snapshotted before start() because
  // actions open their first sockets synchronously. Time only advances once every open
  // socket has been answered, so a fresh socket never times out before its handler runs.
  async function drive(start, handlers, advance, stepMs = 1500) {
    const seen = new Set(FakeWebSocket.instances);
    const p = start();
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    for (let guard = 0; guard < 1000 && !settled; guard++) {
      for (const ws of [...FakeWebSocket.instances]) {
        if (seen.has(ws)) continue;
        seen.add(ws);
        const h = handlers[ws.url];
        if (h) h(ws);
        else ws.fail();
      }
      await flush();
      if (FakeWebSocket.instances.some((ws) => !seen.has(ws))) continue;
      advance(stepMs);
      await flush();
    }
    return p;
  }

  test("scanNetwork lists new-firmware and legacy boxes, skipping silent hosts", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(() => service.handleRuntimeMessage({ action: "scanNetwork", prefix: "10.0.0.x", wsPort: 81 }), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(netInfo()); },
      "ws://10.0.0.40:81/": (ws) => { ws.open(); ws.receive(reading("ST", 1, { device: "HR250A", id: "OLDBOX000001" })); },
    }, advance);
    assert.equal(res.ok, true);
    assert.deepEqual(res.devices, [
      { ip: "10.0.0.7", wsPort: 81, id: "AABBCCDDEEFF", mode: "dhcp", setupLeftSec: 420, fw: "0.4.0", legacy: false, canSetup: true },
      { ip: "10.0.0.40", wsPort: 81, id: "OLDBOX000001", mode: "", setupLeftSec: 0, fw: "", legacy: true, canSetup: false },
    ]);
    assert.equal(FakeWebSocket.instances.filter((w) => w.url.startsWith("ws://10.0.0.")).length >= 254, true);
    assert.equal(storage.session.data.live.scan, null);
  });

  test("scanNetwork marks a box whose setup window closed as not settable", async () => {
    const { service, advance } = await setup();
    const res = await drive(() => service.handleRuntimeMessage({ action: "scanNetwork", prefix: "10.0.0", wsPort: 81 }), { "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(netInfo({ setupLeftSec: 0 })); } }, advance);
    assert.equal(res.devices[0].canSetup, false);
  });

  test("scanNetwork rejects a bad prefix or port without opening sockets", async () => {
    const { service } = await setup();
    const before = FakeWebSocket.instances.length;
    assert.equal((await service.handleRuntimeMessage({ action: "scanNetwork", prefix: "10.0", wsPort: 81 })).ok, false);
    assert.equal((await service.handleRuntimeMessage({ action: "scanNetwork", prefix: "10.0.0", wsPort: 0 })).ok, false);
    assert.equal(FakeWebSocket.instances.length, before);
  });

  test("useDevice saves the IP after the box answers and reconnects to it", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(() => service.handleRuntimeMessage({ action: "useDevice", ip: "10.0.0.7", wsPort: 81 }), { "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(netInfo()); } }, advance);
    assert.equal(res.ok, true);
    assert.equal(storage.local.data.deviceIp, "10.0.0.7");
    assert.equal(FakeWebSocket.last.url, "ws://10.0.0.7:81/");
  });

  test("useDevice does not save when nothing answers", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(() => service.handleRuntimeMessage({ action: "useDevice", ip: "10.0.0.7", wsPort: 81 }), {}, advance);
    assert.equal(res.ok, false);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  const setMsg = (extra = {}) => ({
    action: "setDeviceNetwork", mode: "static", currentIp: "10.0.0.7", wsPort: 81, id: "AABBCCDDEEFF",
    ip: "10.0.0.50", gw: "10.0.0.1", mask: "", dns: "", ...extra,
  });
  const saved = JSON.stringify({ type: "net", ok: true, msg: "saved", restartInMs: 1500 });

  test("setDeviceNetwork sends SET, re-finds the box at the new IP and saves it", async () => {
    const { service, storage, advance } = await setup();
    const sent = [];
    const res = await drive(() => service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); sent.push(...ws.sent); ws.receive(saved); },
      "ws://10.0.0.50:81/": (ws) => { ws.open(); ws.receive(netInfo({ ip: "10.0.0.50", mode: "static" })); },
    }, advance, 2000);
    assert.deepEqual(sent, ["CMD:NET:SET:10.0.0.50,10.0.0.1,255.255.255.0"]);
    assert.deepEqual(res, { ok: true, ip: "10.0.0.50", id: "AABBCCDDEEFF" });
    assert.equal(storage.local.data.deviceIp, "10.0.0.50");
    assert.equal(FakeWebSocket.last.url, "ws://10.0.0.50:81/");
  });

  test("setDeviceNetwork writes step-by-step progress to live state (keeps the worker busy)", async () => {
    const { service, storage, advance } = await setup();
    const stages = [];
    const origSet = storage.session.set.bind(storage.session);
    storage.session.set = async (obj) => {
      const s = obj.live?.netSetup;
      if (s && stages.at(-1) !== s.stage) stages.push(s.stage);
      return origSet(obj);
    };
    let attempts = 0;
    const res = await drive(() => service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(saved); },
      "ws://10.0.0.50:81/": (ws) => {
        if (++attempts < 3) return ws.fail(); // box still restarting
        ws.open();
        ws.receive(netInfo({ ip: "10.0.0.50" }));
      },
    }, advance, 2000);
    assert.equal(res.ok, true);
    assert.deepEqual(stages, ["sending", "restarting"]);
    assert.equal(storage.session.data.live.netSetup, null);
  });

  test("setDeviceNetwork reports setup-closed and saves nothing", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(() => service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(JSON.stringify({ type: "net", ok: false, error: "setup-closed" })); },
    }, advance);
    assert.equal(res.ok, false);
    assert.match(res.error, /10 phút/);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("setDeviceNetwork blocks invalid input before sending anything", async () => {
    const { service } = await setup();
    const before = FakeWebSocket.instances.length;
    const res = await service.handleRuntimeMessage(setMsg({ gw: "10.0.1.1" }));
    assert.equal(res.ok, false);
    assert.match(res.error, /cùng dải mạng/);
    assert.equal((await service.handleRuntimeMessage(setMsg({ id: "" }))).ok, false);
    assert.equal(FakeWebSocket.instances.length, before);
  });

  test("setDeviceNetwork keeps the old config when the box never shows up at the new IP", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(() => service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(saved); },
    }, advance, 2000);
    assert.equal(res.ok, false);
    assert.match(res.error, /vẫn giữ IP mới/);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("setDeviceNetwork ignores a different box answering at the new IP", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(() => service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(saved); },
      "ws://10.0.0.50:81/": (ws) => { ws.open(); ws.receive(netInfo({ id: "OTHERBOX0000" })); },
    }, advance, 2000);
    assert.equal(res.ok, false);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("setDeviceNetwork in DHCP mode sends CMD:NET:DHCP and asks to rescan", async () => {
    const { service, storage, advance } = await setup();
    const sent = [];
    const res = await drive(() => service.handleRuntimeMessage(setMsg({ mode: "dhcp", ip: "", gw: "" })), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); sent.push(...ws.sent); ws.receive(saved); },
    }, advance);
    assert.deepEqual(sent, ["CMD:NET:DHCP"]);
    assert.deepEqual(res, { ok: true, dhcp: true });
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("getState returns live, config and history", async () => {
    const { service } = await setup();
    const s = await service.handleRuntimeMessage({ action: "getState" });
    assert.equal(s.ok, true);
    assert.equal(s.config.deviceIp, "10.0.0.5");
    assert.ok(Array.isArray(s.history));
    assert.ok(s.live);
  });

  test("unknown actions are rejected", async () => {
    const { service } = await setup();
    assert.equal((await service.handleRuntimeMessage({ action: "nope" })).ok, false);
  });

  test("keepalive reconnects a dropped connection", async () => {
    const { ws, service, advance } = await setup();
    ws().open();
    ws().drop();
    advance(1000); // retry opens socket #2
    assert.equal(FakeWebSocket.instances.length, 2);
    service.keepalive(); // socket #2 still CONNECTING → no extra socket
    assert.equal(FakeWebSocket.instances.length, 2);
  });
});
