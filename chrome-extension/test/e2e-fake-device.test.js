// End-to-end over real sockets: fake gateway ⇄ Node's WebSocket ⇄ the real service.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { createFakeDevice, formatAndLine } from "../tools/fake-device.mjs";
import { createService } from "../src/background/service.js";
import { createFakeStorageArea } from "./helpers.js";

const waitFor = async (cond, timeoutMs = 3000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("formatAndLine (fake device)", () => {
  test("matches the A&D standard format", () => {
    assert.equal(formatAndLine("ST", 12.3456), "ST,+00012.3456  g");
    assert.equal(formatAndLine("US", -0.0012), "US,-00000.0012  g");
    assert.equal(formatAndLine("OL", null), "OL,+9999999E+19");
  });
});

describe("e2e with fake device", () => {
  let device, port, service, storage;
  const notified = [];

  before(async () => {
    device = createFakeDevice({ port: 0, host: "127.0.0.1", tickMs: 20, settleMs: 100 });
    port = await device.start();
    storage = {
      local: createFakeStorageArea({ deviceIp: "127.0.0.1", wsPort: port }),
      session: createFakeStorageArea(),
    };
    service = createService({
      WebSocketImpl: WebSocket,
      storage,
      notifier: async (payload) => (notified.push(payload), { ok: true, tabId: 1 }),
    });
    await service.init();
    await waitFor(() => storage.session.data.live?.status === "connected");
  });

  after(async () => {
    await service.handleRuntimeMessage({ action: "disconnect" });
    await device.stop();
  });

  test("put → exactly one push; remove → no 0 g push; same sample again → pushed", async () => {
    const put = await service.handleRuntimeMessage({ action: "sendCommand", cmd: "CMD:SIM:PUT:12.3456" });
    assert.equal(put.ok, true);
    await waitFor(() => notified.length === 1);
    assert.equal(notified[0].valueText, "12.3456");
    assert.equal(notified[0].sim, true);

    await sleep(300); // stays stable: no duplicate
    assert.equal(notified.length, 1);

    await service.handleRuntimeMessage({ action: "sendCommand", cmd: "CMD:SIM:REMOVE" });
    await sleep(300);
    assert.equal(notified.length, 1);

    await service.handleRuntimeMessage({ action: "sendCommand", cmd: "CMD:SIM:PUT:12.3456" });
    await waitFor(() => notified.length === 2);
  });

  test("tare (T) brings the display to zero without a push", async () => {
    const before = notified.length;
    await service.handleRuntimeMessage({ action: "sendCommand", cmd: "T" });
    await waitFor(() => storage.session.data.live?.lastReading?.valueText === "0.0000");
    await sleep(100);
    assert.equal(notified.length, before);
  });

  test("testConnection succeeds against the running device", async () => {
    const res = await service.handleRuntimeMessage({ action: "testConnection", deviceIp: "127.0.0.1", wsPort: port });
    assert.equal(res.ok, true);
    assert.equal(res.reading.sim, true);
  });
});

describe("e2e network setup with fake device", () => {
  let device, port, service, storage;

  before(async () => {
    device = createFakeDevice({ port: 0, host: "127.0.0.1", tickMs: 50, id: "AABBCCDDEEFF" });
    port = await device.start();
    storage = { local: createFakeStorageArea({ autoConnect: false }), session: createFakeStorageArea() };
    service = createService({ WebSocketImpl: WebSocket, storage, notifier: async () => ({ ok: true, tabId: 1 }) });
    await service.init();
  });

  after(() => device.stop());

  const setMsg = () => ({
    action: "setDeviceNetwork", mode: "static", currentIp: "127.0.0.1", wsPort: port, id: "AABBCCDDEEFF",
    ip: "127.0.0.1", gw: "127.0.0.2", mask: "255.255.255.0", dns: "",
  });

  test("scanNetwork finds the fake device on 127.0.0.x", async () => {
    const res = await service.handleRuntimeMessage({ action: "scanNetwork", prefix: "127.0.0", wsPort: port });
    assert.equal(res.ok, true);
    const d = res.devices.find((x) => x.ip === "127.0.0.1");
    assert.ok(d, "device found");
    assert.equal(d.id, "AABBCCDDEEFF");
    assert.equal(d.canSetup, true);
  });

  test("setDeviceNetwork sends SET and saves the IP once the box answers there", async () => {
    const res = await service.handleRuntimeMessage(setMsg());
    assert.equal(res.ok, true, res.error);
    assert.equal(device.lastNetCommand, "CMD:NET:SET:127.0.0.1,127.0.0.2,255.255.255.0");
    assert.equal(storage.local.data.deviceIp, "127.0.0.1");
  });

  test("a closed setup window is reported in Vietnamese", async () => {
    device.setupOpen = false;
    try {
      const res = await service.handleRuntimeMessage(setMsg());
      assert.equal(res.ok, false);
      assert.match(res.error, /10 phút/);
    } finally {
      device.setupOpen = true;
    }
  });
});
