import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { DEFAULTS, normalizeConfig, deviceUrl } from "../src/lib/config.js";
import { parseDeviceMessage, parseNetMessage, toWebPayload } from "../src/lib/reading.js";
import { createPushGate } from "../src/lib/push-gate.js";
import { pickTargetTab, isTargetTab, targetHosts, urlPatternsFor } from "../src/lib/tab-picker.js";
import { createBackoff } from "../src/lib/backoff.js";
import { addEntry } from "../src/lib/history.js";
import { validateStaticNet, netSetCommand, formatMac, NET_INFO_COMMAND, NET_DHCP_COMMAND } from "../src/lib/net-config.js";
import { DEFAULT_PREFIX, normalizePrefix, prefixOf, hostsIn, runPool } from "../src/lib/scan.js";

// Build a device message the way the firmware's readingToJson() does
function msg(header, value, unit = "g", extra = {}) {
  const valueStr = value === null ? null : value.toFixed(4);
  return JSON.stringify({
    type: "reading",
    device: "HR250A",
    header,
    stable: header === "ST",
    unstable: header === "US",
    overload: header === "OL",
    counting: header === "QT",
    value: valueStr === null ? null : Number(valueStr),
    unit,
    weight: valueStr === null ? "" : `${valueStr} ${unit}`,
    raw: `${header},...`,
    ...extra,
  });
}
const read = (header, value, unit, extra) => parseDeviceMessage(msg(header, value, unit, extra), new Date(2026, 8, 24, 8, 5, 9));

describe("config", () => {
  test("defaults are valid except the missing IP", () => {
    const { config, errors } = normalizeConfig({});
    assert.deepEqual(config, { ...DEFAULTS });
    assert.equal(errors.length, 1);
  });

  test("strips scheme, port and path from the IP field", () => {
    const { config, errors } = normalizeConfig({ deviceIp: " ws://172.16.10.70:81/ " });
    assert.equal(config.deviceIp, "172.16.10.70");
    assert.deepEqual(errors, []);
  });

  test("rejects an out-of-range IPv4 and a bad port", () => {
    const { errors } = normalizeConfig({ deviceIp: "172.16.10.300", wsPort: 70000 });
    assert.equal(errors.length, 2);
  });

  test("accepts hostnames such as localhost", () => {
    assert.deepEqual(normalizeConfig({ deviceIp: "localhost" }).errors, []);
  });

  test("rejects negative minWeight and coerces numbers from strings", () => {
    const bad = normalizeConfig({ deviceIp: "10.0.0.1", minWeight: -1 });
    assert.equal(bad.errors.length, 1);
    const ok = normalizeConfig({ deviceIp: "10.0.0.1", wsPort: "8181", minWeight: "0.01", connectTimeoutSec: "99" });
    assert.equal(ok.config.wsPort, 8181);
    assert.equal(ok.config.minWeight, 0.01);
    assert.equal(ok.config.connectTimeoutSec, 30);
  });

  test("rejects an empty minWeight instead of treating it as 0", () => {
    const { config, errors } = normalizeConfig({ deviceIp: "10.0.0.1", minWeight: " " });
    assert.equal(errors.length, 1);
    assert.equal(config.minWeight, DEFAULTS.minWeight);
  });

  test("allowLocalhost is off unless explicitly true", () => {
    assert.equal(normalizeConfig({}).config.allowLocalhost, false);
    assert.equal(normalizeConfig({ allowLocalhost: "yes" }).config.allowLocalhost, false);
    assert.equal(normalizeConfig({ allowLocalhost: true }).config.allowLocalhost, true);
  });

  test("autoConnect stays true unless explicitly false", () => {
    assert.equal(normalizeConfig({ autoConnect: undefined }).config.autoConnect, true);
    assert.equal(normalizeConfig({ autoConnect: false }).config.autoConnect, false);
  });

  test("deviceUrl", () => {
    assert.equal(deviceUrl({ deviceIp: "10.0.0.5", wsPort: 81 }), "ws://10.0.0.5:81/");
  });
});

describe("reading", () => {
  test("parses a stable reading and keeps trailing zeros in valueText", () => {
    const r = read("ST", 12.34);
    assert.equal(r.status, "STABLE");
    assert.equal(r.stable, true);
    assert.equal(r.value, 12.34);
    assert.equal(r.valueText, "12.3400");
    assert.equal(r.unit, "g");
    assert.equal(r.Date, "2026-09-24");
    assert.equal(r.Time, "08:05:09");
    assert.equal(r.sim, false);
  });

  test("maps headers to statuses", () => {
    assert.equal(read("US", 1).status, "UNSTABLE");
    assert.equal(read("QT", 12, "PC").status, "COUNT");
    const ol = read("OL", null);
    assert.equal(ol.status, "OVERLOAD");
    assert.equal(ol.value, null);
    assert.equal(ol.valueText, "");
  });

  test("keeps the sign of negative values", () => {
    assert.equal(read("ST", -0.0012).valueText, "-0.0012");
  });

  test("falls back to the numeric value when weight is missing", () => {
    const r = parseDeviceMessage(JSON.stringify({ type: "reading", stable: true, value: 5.5, unit: "g" }));
    assert.equal(r.valueText, "5.5");
  });

  test("reads the sim flag", () => {
    assert.equal(read("ST", 1, "g", { sim: true }).sim, true);
  });

  test("rejects anything that is not a valid reading", () => {
    assert.equal(parseDeviceMessage("not json"), null);
    assert.equal(parseDeviceMessage("null"), null);
    assert.equal(parseDeviceMessage(JSON.stringify({ type: "error", code: "E02" })), null);
    assert.equal(parseDeviceMessage(JSON.stringify({ value: 1, unit: "g" })), null);
    assert.equal(parseDeviceMessage(JSON.stringify({ type: "reading", stable: true, value: null, unit: "g" })), null);
    assert.equal(parseDeviceMessage(JSON.stringify({ type: "reading", stable: true, value: "12", unit: "g" })), null);
  });

  test("toWebPayload has the fields the web callback reads", () => {
    const p = toWebPayload(read("ST", 12.34, "g", { sim: true }));
    assert.deepEqual(p, {
      device: "HR250A",
      value: 12.34,
      valueText: "12.3400",
      unit: "g",
      stable: true,
      Status: "STABLE",
      Date: "2026-09-24",
      Time: "08:05:09",
      sim: true,
    });
  });
});

describe("push-gate", () => {
  const run = (gate, seq) => seq.map(([h, v, u]) => gate.decide(read(h, v, u)));

  test("pushes once per stabilization, ignores US/ST flicker at the same value", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    const out = run(gate, [
      ["US", 5.1], ["ST", 5.1234], ["ST", 5.1234], ["US", 5.1234], ["ST", 5.1234],
    ]);
    assert.deepEqual(out, ["skip", "push", "skip", "skip", "skip"]);
  });

  test("never pushes zero or negative values (removing the sample)", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    assert.deepEqual(run(gate, [["ST", 0], ["ST", -0.0005], ["ST", 0.001]]), ["skip", "skip", "skip"]);
  });

  test("the same sample can be pushed again after returning to zero", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    const out = run(gate, [["ST", 5.1234], ["US", 2], ["ST", 0], ["US", 3], ["ST", 5.1234]]);
    assert.deepEqual(out, ["push", "skip", "skip", "skip", "push"]);
  });

  test("adding more sample (passes through US) pushes the new value", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    assert.deepEqual(run(gate, [["ST", 5], ["US", 7], ["ST", 7.25]]), ["push", "skip", "push"]);
  });

  test("slow drift while stable does not push", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    assert.deepEqual(run(gate, [["ST", 5.1234], ["ST", 5.1235]]), ["push", "skip"]);
  });

  test("overload re-arms but never pushes", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    assert.deepEqual(run(gate, [["ST", 5], ["OL", null], ["ST", 6]]), ["push", "skip", "push"]);
  });

  test("counting mode and non-gram units are skipped", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    assert.deepEqual(run(gate, [["QT", 12, "PC"], ["ST", 500, "mg"]]), ["skip", "skip"]);
  });

  test("respects a custom threshold", () => {
    const gate = createPushGate({ minWeight: 1 });
    assert.deepEqual(run(gate, [["ST", 0.5], ["ST", 1.5]]), ["skip", "push"]);
  });

  test("reset() re-arms and forgets the last value", () => {
    const gate = createPushGate({ minWeight: 0.001 });
    run(gate, [["ST", 5]]);
    gate.reset();
    assert.equal(gate.decide(read("ST", 5)), "push");
  });
});

describe("tab-picker", () => {
  const tab = (id, url, extra = {}) => ({ id, url, windowId: 1, active: false, lastAccessed: 0, ...extra });

  test("only considers qlcl tabs", () => {
    assert.equal(isTargetTab(tab(1, "https://qlcl.hungduy.vn/solieu")), true);
    assert.equal(isTargetTab(tab(2, "https://evil.example/qlcl.hungduy.vn")), false);
    assert.equal(isTargetTab(tab(3, undefined)), false);
    assert.equal(pickTargetTab([tab(1, "https://google.com", { active: true })], 1), null);
    assert.equal(pickTargetTab([], 1), null);
  });

  test("prefers the active qlcl tab in the focused window", () => {
    const tabs = [
      tab(1, "https://qlcl.hungduy.vn/a", { active: true, windowId: 2, lastAccessed: 99 }),
      tab(2, "https://qlcl.hungduy.vn/b", { active: true, windowId: 1 }),
    ];
    assert.equal(pickTargetTab(tabs, 1).id, 2);
  });

  test("then an active qlcl tab in any window", () => {
    const tabs = [
      tab(1, "https://qlcl.hungduy.vn/a", { lastAccessed: 99 }),
      tab(2, "https://qlcl.hungduy.vn/b", { active: true, windowId: 3 }),
    ];
    assert.equal(pickTargetTab(tabs, 1).id, 2);
  });

  test("localhost is a target only when allowed (local dev of the web)", () => {
    const local = tab(1, "https://localhost:7008/SoLieu", { active: true });
    assert.equal(isTargetTab(local), false);
    assert.equal(isTargetTab(local, targetHosts({ allowLocalhost: true })), true);
    assert.equal(isTargetTab(tab(2, "http://127.0.0.1:5266/"), targetHosts({ allowLocalhost: true })), true);
    assert.equal(pickTargetTab([local], 1), null);
    assert.equal(pickTargetTab([local], 1, targetHosts({ allowLocalhost: true })).id, 1);
  });

  test("targetHosts / urlPatternsFor", () => {
    assert.deepEqual(targetHosts({ allowLocalhost: false }), ["qlcl.hungduy.vn"]);
    assert.deepEqual(targetHosts({ allowLocalhost: true }), ["qlcl.hungduy.vn", "localhost", "127.0.0.1"]);
    assert.deepEqual(urlPatternsFor(["qlcl.hungduy.vn"]), ["http://qlcl.hungduy.vn/*", "https://qlcl.hungduy.vn/*"]);
  });

  test("then the most recently accessed qlcl tab", () => {
    const tabs = [
      tab(1, "https://qlcl.hungduy.vn/a", { lastAccessed: 10 }),
      tab(2, "http://qlcl.hungduy.vn/b", { lastAccessed: 30 }),
      tab(3, "https://qlcl.hungduy.vn/c", { lastAccessed: 20 }),
    ];
    assert.equal(pickTargetTab(tabs, 1).id, 2);
  });
});

describe("backoff", () => {
  test("doubles up to the max and resets", () => {
    const b = createBackoff(1000, 5000);
    assert.deepEqual([b.next(), b.next(), b.next(), b.next(), b.next()], [1000, 2000, 4000, 5000, 5000]);
    b.reset();
    assert.equal(b.next(), 1000);
  });
});

describe("history", () => {
  test("adds newest first, caps the length, does not mutate", () => {
    const list = [{ n: 1 }, { n: 2 }];
    const out = addEntry(list, { n: 0 }, 2);
    assert.deepEqual(out, [{ n: 0 }, { n: 1 }]);
    assert.deepEqual(list, [{ n: 1 }, { n: 2 }]);
  });
});

describe("net-config", () => {
  const ok = { ip: "172.16.10.50", gw: "172.16.10.1", mask: "", dns: "" };

  test("accepts a valid static config and defaults the mask", () => {
    const { net, errors } = validateStaticNet({ ...ok, ip: " 172.16.10.50 " });
    assert.deepEqual(errors, []);
    assert.deepEqual(net, { ip: "172.16.10.50", gw: "172.16.10.1", mask: "255.255.255.0", dns: "" });
  });

  test("rejects invalid IPv4 fields, including a mask typed as 24", () => {
    assert.equal(validateStaticNet({ ...ok, ip: "172.16.10.300" }).errors.length, 1);
    assert.equal(validateStaticNet({ ...ok, gw: "" }).errors.length, 1);
    assert.equal(validateStaticNet({ ...ok, mask: "24" }).errors.length, 1);
    assert.equal(validateStaticNet({ ...ok, dns: "8.8.8" }).errors.length, 1);
  });

  test("rejects a non-contiguous or too-small mask", () => {
    assert.equal(validateStaticNet({ ...ok, mask: "255.0.255.0" }).errors.length, 1);
    assert.equal(validateStaticNet({ ...ok, mask: "255.255.255.255" }).errors.length, 1);
  });

  test("rejects IP equal to gateway, gateway in another subnet, network/broadcast IP", () => {
    assert.match(validateStaticNet({ ...ok, ip: "172.16.10.1" }).errors[0], /trùng gateway/);
    assert.match(validateStaticNet({ ...ok, gw: "172.16.11.1" }).errors[0], /cùng dải mạng/);
    assert.match(validateStaticNet({ ...ok, ip: "172.16.10.0" }).errors[0], /mạng\/broadcast/);
    assert.match(validateStaticNet({ ...ok, ip: "172.16.10.255" }).errors[0], /mạng\/broadcast/);
    assert.deepEqual(validateStaticNet({ ...ok, ip: "172.16.11.5", gw: "172.16.10.1", mask: "255.255.252.0" }).errors, []);
  });

  test("builds the SET command, with DNS only when given", () => {
    const { net } = validateStaticNet(ok);
    assert.equal(netSetCommand(net), "CMD:NET:SET:172.16.10.50,172.16.10.1,255.255.255.0");
    assert.equal(netSetCommand({ ...net, dns: "172.16.10.1" }), "CMD:NET:SET:172.16.10.50,172.16.10.1,255.255.255.0,172.16.10.1");
    assert.ok(netSetCommand({ ip: "255.255.255.255", gw: "255.255.255.255", mask: "255.255.255.255", dns: "255.255.255.255" }).length <= 96);
    assert.equal(NET_INFO_COMMAND, "CMD:NET:INFO");
    assert.equal(NET_DHCP_COMMAND, "CMD:NET:DHCP");
  });

  test("formats a MAC with colons", () => {
    assert.equal(formatMac("781C3CCA2FA7"), "78:1C:3C:CA:2F:A7");
    assert.equal(formatMac(""), "");
  });
});

describe("scan", () => {
  test("normalizePrefix accepts 3 octets with optional trailing dot, .x or spaces", () => {
    for (const input of ["172.16.10", " 172.16.10 ", "172.16.10.", "172.16.10.x", "172.16.10.*"]) {
      assert.deepEqual(normalizePrefix(input), { prefix: "172.16.10", error: null }, input);
    }
  });

  test("normalizePrefix rejects anything that is not 3 valid octets", () => {
    for (const input of ["", "172.16", "172.16.10.5", "172.16.300", "abc.def.ghi"]) {
      assert.equal(normalizePrefix(input).prefix, null, input);
      assert.match(normalizePrefix(input).error, /không hợp lệ/, input);
    }
  });

  test("prefixOf takes the first 3 octets of an IPv4, else null", () => {
    assert.equal(prefixOf("172.16.10.223"), "172.16.10");
    assert.equal(prefixOf(""), null);
    assert.equal(prefixOf("localhost"), null);
    assert.equal(DEFAULT_PREFIX, "172.16.10");
  });

  test("hostsIn lists .1 to .254", () => {
    const hosts = hostsIn("10.0.0");
    assert.equal(hosts.length, 254);
    assert.equal(hosts[0], "10.0.0.1");
    assert.equal(hosts[253], "10.0.0.254");
  });

  test("runPool never exceeds the limit, keeps order and reports progress", async () => {
    let running = 0;
    let peak = 0;
    const progress = [];
    const out = await runPool(
      [1, 2, 3, 4, 5, 6, 7],
      3,
      async (n) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 5 * (8 - n)));
        running--;
        return n * 10;
      },
      (done, total) => progress.push(`${done}/${total}`),
    );
    assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
    assert.equal(peak, 3);
    assert.equal(progress.length, 7);
    assert.equal(progress.at(-1), "7/7");
  });
});

describe("net messages", () => {
  test("parseNetMessage returns type:net objects only", () => {
    const info = parseNetMessage(JSON.stringify({ type: "net", ok: true, device: "HR250A", id: "AABB", setupLeftSec: 30 }));
    assert.equal(info.id, "AABB");
    assert.equal(info.setupLeftSec, 30);
    assert.equal(parseNetMessage(msg("ST", 1)), null);
    assert.equal(parseNetMessage("garbage"), null);
  });

  test("readings keep the device id and name", () => {
    const r = read("ST", 1, "g", { id: "781C3CCA2FA7" });
    assert.equal(r.id, "781C3CCA2FA7");
    assert.equal(r.device, "HR250A");
    assert.equal(read("ST", 1).id, "");
  });
});
