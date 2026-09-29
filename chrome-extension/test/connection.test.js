import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createConnection, probeDevice, netRequest } from "../src/background/connection.js";
import { FakeWebSocket, createFakeTimers } from "./helpers.js";

function setup(url = "ws://10.0.0.5:81/") {
  FakeWebSocket.reset();
  const timers = createFakeTimers();
  const messages = [];
  const statuses = [];
  const conn = createConnection({
    WebSocketImpl: FakeWebSocket,
    getUrl: () => url,
    onMessage: (m) => messages.push(m),
    onStatus: (s) => statuses.push(s),
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });
  return { conn, timers, messages, statuses };
}

describe("connection", () => {
  beforeEach(() => FakeWebSocket.reset());

  test("connects, forwards messages and reports status", () => {
    const { conn, messages, statuses } = setup();
    conn.start();
    assert.equal(FakeWebSocket.last.url, "ws://10.0.0.5:81/");
    FakeWebSocket.last.open();
    FakeWebSocket.last.receive("hello");
    assert.deepEqual(messages, ["hello"]);
    assert.deepEqual(statuses, ["connecting", "connected"]);
    assert.equal(conn.isOpen(), true);
  });

  test("reconnects with exponential backoff and resets it after a success", () => {
    const { conn, timers } = setup();
    conn.start();
    FakeWebSocket.last.drop(); // attempt 1 fails → retry in 1s
    assert.equal(FakeWebSocket.instances.length, 1);
    timers.tick(999);
    assert.equal(FakeWebSocket.instances.length, 1);
    timers.tick(1);
    assert.equal(FakeWebSocket.instances.length, 2);

    FakeWebSocket.last.drop(); // → retry in 2s
    timers.tick(1999);
    assert.equal(FakeWebSocket.instances.length, 2);
    timers.tick(1);
    assert.equal(FakeWebSocket.instances.length, 3);

    FakeWebSocket.last.open(); // success resets backoff
    FakeWebSocket.last.drop(); // → retry in 1s again
    timers.tick(1000);
    assert.equal(FakeWebSocket.instances.length, 4);
  });

  test("an error closes the socket and schedules a retry", () => {
    const { conn, timers, statuses } = setup();
    conn.start();
    FakeWebSocket.last.fail();
    assert.equal(statuses.at(-1), "reconnecting");
    timers.tick(1000);
    assert.equal(FakeWebSocket.instances.length, 2);
  });

  test("stop() closes the socket and never reconnects", () => {
    const { conn, timers, statuses } = setup();
    conn.start();
    FakeWebSocket.last.open();
    conn.stop();
    assert.equal(statuses.at(-1), "disconnected");
    timers.tick(60000);
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(timers.pendingCount, 0);
  });

  test("stop() during a pending retry cancels it", () => {
    const { conn, timers } = setup();
    conn.start();
    FakeWebSocket.last.drop();
    conn.stop();
    timers.tick(60000);
    assert.equal(FakeWebSocket.instances.length, 1);
  });

  test("start() while connected replaces the socket without a stray reconnect", () => {
    const { conn, timers } = setup();
    conn.start();
    const first = FakeWebSocket.last;
    first.open();
    conn.start();
    assert.equal(first.readyState, FakeWebSocket.CLOSED);
    assert.equal(FakeWebSocket.instances.length, 2);
    timers.tick(60000);
    assert.equal(FakeWebSocket.instances.length, 2);
  });

  test("ensure() reopens a dead connection only when wanted and idle", () => {
    const { conn } = setup();
    conn.ensure(); // not wanted → nothing
    assert.equal(FakeWebSocket.instances.length, 0);
    conn.start();
    FakeWebSocket.last.open();
    conn.ensure(); // already open → nothing
    assert.equal(FakeWebSocket.instances.length, 1);
  });

  test("ensure() does not open a second socket while a retry is pending", () => {
    const { conn, timers } = setup();
    conn.start();
    FakeWebSocket.last.drop();
    conn.ensure();
    assert.equal(FakeWebSocket.instances.length, 1);
    timers.tick(1000);
    assert.equal(FakeWebSocket.instances.length, 2);
  });

  test("send() only works while open", () => {
    const { conn } = setup();
    assert.equal(conn.send("Z"), false);
    conn.start();
    assert.equal(conn.send("Z"), false);
    FakeWebSocket.last.open();
    assert.equal(conn.send("Z"), true);
    assert.deepEqual(FakeWebSocket.last.sent, ["Z"]);
  });

  test("without a URL it stays disconnected and does not retry", () => {
    const { conn, timers, statuses } = setup(null);
    conn.start();
    assert.equal(FakeWebSocket.instances.length, 0);
    assert.equal(statuses.at(-1), "disconnected");
    timers.tick(60000);
    assert.equal(FakeWebSocket.instances.length, 0);
  });
});

describe("probeDevice", () => {
  const valid = JSON.stringify({ type: "reading", stable: true, value: 1.5, unit: "g", weight: "1.5000 g" });

  test("resolves ok on the first valid reading and closes the socket", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = probeDevice({
      WebSocketImpl: FakeWebSocket, url: "ws://x/", timeoutMs: 5000,
      setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
    });
    const ws = FakeWebSocket.last;
    ws.open();
    ws.receive("garbage");
    ws.receive(valid);
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.reading.valueText, "1.5000");
    assert.equal(ws.readyState, FakeWebSocket.CLOSED);
  });

  test("times out when connected but no valid reading arrives", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = probeDevice({
      WebSocketImpl: FakeWebSocket, url: "ws://x/", timeoutMs: 5000,
      setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
    });
    FakeWebSocket.last.open();
    timers.tick(5000);
    const res = await p;
    assert.equal(res.ok, false);
    assert.match(res.error, /không nhận được/i);
  });

  test("fails fast when the socket errors", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = probeDevice({
      WebSocketImpl: FakeWebSocket, url: "ws://x/", timeoutMs: 5000,
      setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
    });
    FakeWebSocket.last.fail();
    const res = await p;
    assert.equal(res.ok, false);
    assert.match(res.error, /không kết nối được/i);
  });
});

describe("netRequest", () => {
  const netInfo = JSON.stringify({ type: "net", ok: true, device: "HR250A", id: "AABBCCDDEEFF", setupLeftSec: 500 });
  const reading = JSON.stringify({ type: "reading", device: "HR250A", id: "AABBCCDDEEFF", stable: true, value: 1, unit: "g", weight: "1.0000 g" });

  function start(timers) {
    return netRequest({
      WebSocketImpl: FakeWebSocket, url: "ws://10.0.0.9:81/", command: "CMD:NET:INFO", timeoutMs: 1500,
      setTimeoutFn: timers.setTimeout, clearTimeoutFn: timers.clearTimeout,
    });
  }

  test("sends the command on open and resolves with the net reply", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = start(timers);
    const ws = FakeWebSocket.last;
    assert.equal(ws.url, "ws://10.0.0.9:81/");
    ws.open();
    assert.deepEqual(ws.sent, ["CMD:NET:INFO"]);
    ws.receive(netInfo);
    const res = await p;
    assert.equal(res.ok, true);
    assert.equal(res.reply.id, "AABBCCDDEEFF");
    assert.equal(ws.readyState, FakeWebSocket.CLOSED);
  });

  test("ignores a reading that arrives before the net reply", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = start(timers);
    const ws = FakeWebSocket.last;
    ws.open();
    ws.receive(reading);
    ws.receive(netInfo);
    assert.equal((await p).ok, true);
  });

  test("reports a legacy box (readings but no net reply) after the timeout", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = start(timers);
    FakeWebSocket.last.open();
    FakeWebSocket.last.receive(reading);
    timers.tick(1500);
    assert.deepEqual(await p, { ok: false, legacy: true, id: "AABBCCDDEEFF" });
  });

  test("times out when nothing answers", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = start(timers);
    FakeWebSocket.last.open();
    timers.tick(1500);
    assert.deepEqual(await p, { ok: false, error: "timeout" });
  });

  test("fails fast when the socket errors", async () => {
    FakeWebSocket.reset();
    const timers = createFakeTimers();
    const p = start(timers);
    FakeWebSocket.last.fail();
    assert.deepEqual(await p, { ok: false, error: "unreachable" });
    assert.equal(timers.pendingCount, 0);
  });
});
