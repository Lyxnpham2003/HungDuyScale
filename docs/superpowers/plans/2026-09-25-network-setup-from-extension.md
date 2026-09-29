# Network Setup from Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let factory IT find the HR-250A box on the LAN and either adopt its current IP or set a static IP on it, entirely from the Chrome extension, with no USB Serial.

**Architecture:**
- The firmware gains `CMD:NET:INFO` (always answered) and `CMD:NET:SET` / `CMD:NET:DHCP` (answered only in the first 10 minutes after power-up) over the existing WebSocket. Replies are `{"type":"net",…}` JSON sent to the requesting client only.
- The extension adds pure helpers (`src/lib/net-config.js`, `src/lib/scan.js`), a one-shot `netRequest()` in `connection.js`, and three service actions: `scanNetwork`, `useDevice`, `setDeviceNetwork`. It also gets a "Cài đặt hộp cân lần đầu" card in Options.

**Tech Stack:**
- Arduino / ESP32 core 3.3.10, `WebSockets` 2.7.2 (Markus Sattler).
- Chrome MV3 extension in plain ES modules.
- Node ≥ 22 built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-25-network-setup-from-extension-design.md`

## Global Constraints

- Firmware version becomes `0.4.0` (`firmwareVer` in `HungDuyScaleHR250A.ino`). Extension version becomes `1.1.0` (`chrome-extension/manifest.json`).
- The setup window is exactly `600000` ms (10 minutes) after power-up. After that, SET/DHCP reply `setup-closed` until the next power-up, even when `millis()` wraps.
- The firmware restarts `1500` ms after a successful SET/DHCP, not from inside the WebSocket callback.
- The WebSocket text command length cap goes from 32 to `96` characters.
- `type:"net"` JSON is sent only to the client that sent the `CMD:NET:*`, never broadcast. The `type:"reading"` JSON is unchanged.
- Any `CMD:*` over WebSocket other than `CMD:SIM:*` and `CMD:NET:*` is still rejected.
- Scan parameters:
  - hosts `.1`–`.254` of a 3-octet prefix;
  - 32 hosts in parallel;
  - 1500 ms per host;
  - default prefix = first 3 octets of the saved `deviceIp`, else `172.16.10`.
- `setDeviceNetwork`:
  - SET reply timeout 5000 ms;
  - re-find the box at the new IP every 2000 ms for up to 40000 ms;
  - success only when the reply `id` equals the MAC the box had before;
  - save `deviceIp` **only** on success.
- The extension blocks SET before sending when:
  - an IPv4 field is invalid;
  - the mask is invalid (non-contiguous or shorter than /30);
  - IP equals gateway;
  - IP and gateway are in different subnets;
  - IP is the network or broadcast address.
- `sendCommand` and `ALLOWED_COMMAND` stay unchanged. `CMD:NET` is only sent through the new actions.
- UI text is Vietnamese; code and comments are English, matching the existing files.
- Out of scope: no-DHCP networks, mDNS, PIN.

## Review Focus

1. **The box sends a reading before the net reply.** Firmware sends the last reading on connect. `netRequest` must ignore readings and keep waiting for `type:"net"`. Test in Task 4.
2. **Prefix typed with a trailing dot, `.x`, or spaces** (`"172.16.10."`, `"172.16.10.x"`, `" 172.16.10 "`) must be accepted; `"172.16"` and `"172.16.10.300"` must be rejected. Test in Task 2.
3. **Wrong gateway subnet, IP = gateway, network/broadcast IP, mask typed as `24`** must be blocked before anything is sent to the box. Test in Task 1.
4. **SET succeeded but the box never answers at the new IP, or answers with a different MAC.** Extension config must stay unchanged and the error must say the box kept the new IP. Test in Task 6.
5. **Box running for more than 49.7 days (`millis()` wraps)** must not reopen the setup window. A latch in `loopWebSocket()` handles this. The firmware has no unit tests, so Task 8 includes an explicit code check step.

---

### Task 1: Static-IP validation helpers (`net-config.js`)

**Files:**
- Modify: `chrome-extension/src/lib/config.js` (export `isIPv4`)
- Create: `chrome-extension/src/lib/net-config.js`
- Test: `chrome-extension/test/lib.test.js`

**Interfaces:**
- Produces:
  - `isIPv4(s: string): boolean` (from `config.js`)
  - `validateStaticNet({ip, gw, mask, dns}): { net: {ip, gw, mask, dns}, errors: string[] }`. The mask defaults to `"255.255.255.0"` and dns to `""`.
  - `netSetCommand(net): string` → `"CMD:NET:SET:<ip>,<gw>,<mask>[,<dns>]"`
  - `NET_INFO_COMMAND = "CMD:NET:INFO"`, `NET_DHCP_COMMAND = "CMD:NET:DHCP"`
  - `formatMac(id: string): string` → `"78:1C:3C:CA:2F:A7"`

- [ ] **Step 1: Write the failing tests.** Append to `test/lib.test.js`. Add the import at the top next to the other lib imports:

```js
import { validateStaticNet, netSetCommand, formatMac, NET_INFO_COMMAND, NET_DHCP_COMMAND } from "../src/lib/net-config.js";
```

and add this block at the end of the file:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd chrome-extension && node --test --test-timeout=5000 test/lib.test.js`
Expected: FAIL with `Cannot find module '…/src/lib/net-config.js'`.

- [ ] **Step 3: Export `isIPv4` from `config.js`.** Add it right after the `HOSTNAME` constant:

```js
export function isIPv4(s) {
  return IPV4.test(String(s ?? ""));
}
```

- [ ] **Step 4: Create `src/lib/net-config.js`.**

```js
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
```

- [ ] **Step 5: Run the tests to verify they pass.**

Run: `cd chrome-extension && node --test --test-timeout=5000 test/lib.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 6: Commit.**

```bash
git add chrome-extension/src/lib/config.js chrome-extension/src/lib/net-config.js chrome-extension/test/lib.test.js
git commit -m "feat(extension): static-IP validation helpers for box network setup"
```

---

### Task 2: Scan helpers (`scan.js`)

**Files:**
- Create: `chrome-extension/src/lib/scan.js`
- Test: `chrome-extension/test/lib.test.js`

**Interfaces:**
- Produces:
  - `DEFAULT_PREFIX = "172.16.10"`
  - `normalizePrefix(input): { prefix: string|null, error: string|null }`
  - `prefixOf(ip: string): string|null`: `"172.16.10.223"` → `"172.16.10"`
  - `hostsIn(prefix): string[]`: 254 addresses `.1`…`.254`
  - `runPool(items, limit, worker, onProgress?): Promise<any[]>`. Results come back in input order. `worker` must not throw. `onProgress(done, total)` is called after each item.

- [ ] **Step 1: Write the failing tests.** Add the import to `test/lib.test.js`:

```js
import { DEFAULT_PREFIX, normalizePrefix, prefixOf, hostsIn, runPool } from "../src/lib/scan.js";
```

and append:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd chrome-extension && node --test --test-timeout=5000 test/lib.test.js`
Expected: FAIL with `Cannot find module '…/src/lib/scan.js'`.

- [ ] **Step 3: Create `src/lib/scan.js`.**

```js
// Pure helpers for "Tìm hộp cân": which addresses to try, and a bounded worker pool.

export const DEFAULT_PREFIX = "172.16.10";

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// "172.16.10" / "172.16.10." / "172.16.10.x" → "172.16.10"
export function normalizePrefix(input) {
  const s = String(input ?? "")
    .trim()
    .replace(/\.(x|\*)?$/i, "");
  const parts = s.split(".");
  if (parts.length !== 3 || !parts.every((p) => OCTET.test(p))) {
    return { prefix: null, error: `Dải mạng "${String(input ?? "").trim()}" không hợp lệ (ví dụ 172.16.10).` };
  }
  return { prefix: s, error: null };
}

export function prefixOf(ip) {
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(String(ip ?? "").trim());
  return m ? m[1] : null;
}

export function hostsIn(prefix) {
  return Array.from({ length: 254 }, (_, i) => `${prefix}.${i + 1}`);
}

// Runs worker(item) with at most `limit` in flight; results keep the input order.
export async function runPool(items, limit, worker, onProgress = () => {}) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
      done++;
      onProgress(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd chrome-extension && node --test --test-timeout=5000 test/lib.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit.**

```bash
git add chrome-extension/src/lib/scan.js chrome-extension/test/lib.test.js
git commit -m "feat(extension): scan helpers (prefix, host list, bounded pool)"
```

---

### Task 3: Parse `type:"net"` messages; keep `id`/`device` on readings

**Files:**
- Modify: `chrome-extension/src/lib/reading.js`
- Modify: `chrome-extension/src/lib/messages.js` (add `NET_ERROR_TEXT`)
- Modify: `chrome-extension/src/background/service.js` (`handleDeviceMessage`)
- Test: `chrome-extension/test/lib.test.js`, `chrome-extension/test/service.test.js`

**Interfaces:**
- Produces:
  - `parseNetMessage(text): object|null`. Returns the parsed object when `type === "net"`; fields are `ok, device, id, ip, mode, setupLeftSec, fw, msg, restartInMs, error`.
  - The reading from `parseDeviceMessage` gains `id: string` (`""` if missing) and `device: string` (`""` if missing).
  - `NET_ERROR_TEXT` in `messages.js`, with keys `setup-closed` and `bad-args`.

- [ ] **Step 1: Write the failing tests.** In `test/lib.test.js`, extend the reading import:

```js
import { parseDeviceMessage, parseNetMessage, toWebPayload } from "../src/lib/reading.js";
```

and append:

```js
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
```

In `test/service.test.js`, add inside `describe("service", …)`:

```js
  test("net replies on the live socket are not counted as bad messages", async () => {
    const { ws, storage, advance } = await setup();
    ws().open();
    await feed(ws(), JSON.stringify({ type: "net", ok: true, device: "HR250A", id: "AABB" }), "garbage");
    advance(1000);
    await flush();
    assert.equal(storage.session.data.live.badMessages, 1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd chrome-extension && node --test --test-timeout=5000 test/lib.test.js test/service.test.js`
Expected: FAIL. `parseNetMessage` is not exported, and `badMessages` is `2` instead of `1`.

- [ ] **Step 3: Implement in `reading.js`.** Inside `parseDeviceMessage`, add to the returned object (after `sim: d.sim === true,`):

```js
    id: typeof d.id === "string" ? d.id : "",
    device: typeof d.device === "string" ? d.device : "",
```

and add after `parseDeviceMessage`:

```js
// Reply to CMD:NET:* ({"type":"net",...}); sent only to the client that asked.
export function parseNetMessage(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  return d && typeof d === "object" && d.type === "net" ? d : null;
}
```

- [ ] **Step 4: Add `NET_ERROR_TEXT` to `messages.js`** (end of file):

```js
export const NET_ERROR_TEXT = {
  "setup-closed": "Hết 10 phút cài đặt. Rút điện, cắm lại hộp rồi làm lại trong 10 phút.",
  "bad-args": "Hộp không nhận thông số IP (sai định dạng).",
};
```

- [ ] **Step 5: Update `service.js`.**
  - Change the reading import to `import { parseDeviceMessage, parseNetMessage, toWebPayload } from "../lib/reading.js";`
  - Replace the body of `handleDeviceMessage`'s `if (!reading)` branch:

```js
    if (!reading) {
      if (!parseNetMessage(text)) setLive({ badMessages: live.badMessages + 1 });
      return;
    }
```

- [ ] **Step 6: Run the full suite.**

Run: `cd chrome-extension && node --test --test-timeout=5000`
Expected: PASS, 0 fail.

- [ ] **Step 7: Commit.**

```bash
git add chrome-extension/src/lib/reading.js chrome-extension/src/lib/messages.js chrome-extension/src/background/service.js chrome-extension/test
git commit -m "feat(extension): parse CMD:NET replies, keep device id on readings"
```

---

### Task 4: One-shot `netRequest()` in `connection.js`

**Files:**
- Modify: `chrome-extension/src/background/connection.js`
- Test: `chrome-extension/test/connection.test.js`

**Interfaces:**
- Consumes: `parseNetMessage`, `parseDeviceMessage`, `DEVICE_NAME` from `src/lib/reading.js` (Task 3).
- Produces: `netRequest({ WebSocketImpl, url, command, timeoutMs, setTimeoutFn?, clearTimeoutFn? }): Promise<Result>`. It never rejects. `Result` is one of:
  - `{ ok: true, reply }`: the first `type:"net"` message. `reply.ok` may be `false`, for example `setup-closed`.
  - `{ ok: false, legacy: true, id }`: no net reply before the timeout, but an HR250A reading arrived (firmware 0.3.x).
  - `{ ok: false, error: "unreachable" | "timeout" | "closed" }`.

- [ ] **Step 1: Write the failing tests.** In `test/connection.test.js`, change the import to:

```js
import { createConnection, probeDevice, netRequest } from "../src/background/connection.js";
```

and append:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd chrome-extension && node --test --test-timeout=5000 test/connection.test.js`
Expected: FAIL, `netRequest is not a function` (or SyntaxError: no export named `netRequest`).

- [ ] **Step 3: Implement.** In `connection.js`, change the import to

```js
import { parseDeviceMessage, parseNetMessage, DEVICE_NAME } from "../lib/reading.js";
```

and append:

```js
// One-shot CMD:NET:* exchange (scanner and IP setup). Sends `command` on open and
// resolves with the first {"type":"net"} reply. Readings that arrive first (the box
// sends its last reading on connect) are skipped, but remembered: a box that only
// ever sends readings is firmware 0.3.x ("legacy"). Never rejects.
export function netRequest({ WebSocketImpl, url, command, timeoutMs, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  return new Promise((resolve) => {
    let sock;
    let settled = false;
    let legacyId = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeoutFn(timer);
      if (sock) {
        sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
        try {
          sock.close();
        } catch {}
      }
      resolve(result);
    };
    const noReply = (error) => (legacyId !== null ? { ok: false, legacy: true, id: legacyId } : { ok: false, error });

    const timer = setTimeoutFn(() => finish(noReply("timeout")), timeoutMs);

    try {
      sock = new WebSocketImpl(url);
    } catch {
      finish({ ok: false, error: "unreachable" });
      return;
    }
    sock.onopen = () => {
      try {
        sock.send(command);
      } catch {
        finish({ ok: false, error: "unreachable" });
      }
    };
    sock.onmessage = (e) => {
      const reply = parseNetMessage(e.data);
      if (reply) return finish({ ok: true, reply });
      const reading = parseDeviceMessage(e.data);
      if (reading && reading.device === DEVICE_NAME) legacyId = reading.id;
    };
    sock.onerror = () => finish({ ok: false, error: "unreachable" });
    sock.onclose = () => finish(noReply("closed"));
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd chrome-extension && node --test --test-timeout=5000 test/connection.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit.**

```bash
git add chrome-extension/src/background/connection.js chrome-extension/test/connection.test.js
git commit -m "feat(extension): netRequest one-shot for CMD:NET:* exchanges"
```

---

### Task 5: Service actions `scanNetwork` and `useDevice`

**Files:**
- Modify: `chrome-extension/src/background/service.js`
- Test: `chrome-extension/test/service.test.js`

**Interfaces:**
- Consumes:
  - `netRequest` (Task 4);
  - `normalizePrefix`, `hostsIn`, `runPool` (Task 2);
  - `NET_INFO_COMMAND` (Task 1);
  - `DEVICE_NAME` (reading.js).
- Produces runtime actions:
  - `{action:"scanNetwork", prefix, wsPort}` → `{ok:true, devices: Device[]}` or `{ok:false, error}`. Here `Device = {ip, wsPort, id, mode, setupLeftSec, fw, legacy, canSetup}`. While scanning it writes `live.scan = {done, total}`, and `live.scan = null` when done.
  - `{action:"useDevice", ip, wsPort}` → `{ok:true, ip}` after saving `deviceIp`/`wsPort` and reconnecting, or `{ok:false, error}`.

- [ ] **Step 1: Write the failing tests.** Append inside `describe("service", …)` in `test/service.test.js`:

```js
  const netInfo = (extra = {}) =>
    JSON.stringify({ type: "net", ok: true, device: "HR250A", id: "AABBCCDDEEFF", ip: "10.0.0.7", mode: "dhcp", setupLeftSec: 420, fw: "0.4.0", ...extra });

  // Answers each new socket with handlers[url] (or fails it) until the promise settles.
  async function drive(p, handlers, advance, stepMs = 1500) {
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    const seen = new Set(FakeWebSocket.instances);
    for (let guard = 0; guard < 200 && !settled; guard++) {
      for (const ws of [...FakeWebSocket.instances]) {
        if (seen.has(ws)) continue;
        seen.add(ws);
        const h = handlers[ws.url];
        if (h) h(ws);
        else ws.fail();
      }
      await flush();
      advance(stepMs);
      await flush();
    }
    return p;
  }

  test("scanNetwork lists new-firmware and legacy boxes, skipping silent hosts", async () => {
    const { service, storage, advance } = await setup();
    const p = service.handleRuntimeMessage({ action: "scanNetwork", prefix: "10.0.0.x", wsPort: 81 });
    const res = await drive(p, {
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
    const p = service.handleRuntimeMessage({ action: "scanNetwork", prefix: "10.0.0", wsPort: 81 });
    const res = await drive(p, { "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(netInfo({ setupLeftSec: 0 })); } }, advance);
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
    const p = service.handleRuntimeMessage({ action: "useDevice", ip: "10.0.0.7", wsPort: 81 });
    const res = await drive(p, { "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(netInfo()); } }, advance);
    assert.equal(res.ok, true);
    assert.equal(storage.local.data.deviceIp, "10.0.0.7");
    assert.equal(FakeWebSocket.last.url, "ws://10.0.0.7:81/");
  });

  test("useDevice does not save when nothing answers", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(service.handleRuntimeMessage({ action: "useDevice", ip: "10.0.0.7", wsPort: 81 }), {}, advance);
    assert.equal(res.ok, false);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd chrome-extension && node --test --test-timeout=10000 test/service.test.js`
Expected: FAIL; the unknown action returns `ok:false` with "Không hiểu yêu cầu".

- [ ] **Step 3: Implement in `service.js`.** Update the imports:

```js
import { DEFAULTS, normalizeConfig, deviceUrl } from "../lib/config.js";
import { parseDeviceMessage, parseNetMessage, toWebPayload, DEVICE_NAME } from "../lib/reading.js";
import { normalizePrefix, hostsIn, runPool } from "../lib/scan.js";
import { NET_INFO_COMMAND } from "../lib/net-config.js";
import { createConnection, probeDevice, netRequest } from "./connection.js";
```

Add constants after `ALLOWED_COMMAND`:

```js
const SCAN_LIMIT = 32;
const SCAN_TIMEOUT_MS = 1500;
```

Inside `createService`, after `applyConnectionPolicy()`, add:

```js
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
```

Add these cases in `handleRuntimeMessage`, before `default:`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `cd chrome-extension && node --test --test-timeout=10000 test/service.test.js`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit.**

```bash
git add chrome-extension/src/background/service.js chrome-extension/test/service.test.js
git commit -m "feat(extension): scanNetwork and useDevice actions"
```

---

### Task 6: Service action `setDeviceNetwork`

**Files:**
- Modify: `chrome-extension/src/background/service.js`
- Test: `chrome-extension/test/service.test.js`

**Interfaces:**
- Consumes:
  - `askBox`, `portOf`, `saveDevice` (Task 5);
  - `validateStaticNet`, `netSetCommand`, `NET_DHCP_COMMAND`, `NET_INFO_COMMAND` (Task 1);
  - `isIPv4` (config.js);
  - `NET_ERROR_TEXT` (Task 3).
- Produces the action `{action:"setDeviceNetwork", mode: "static"|"dhcp", currentIp, wsPort, id, ip, gw, mask, dns}`, which returns one of:
  - `{ok:true, ip, id}` for static;
  - `{ok:true, dhcp:true}` for DHCP;
  - `{ok:false, error}`.

- [ ] **Step 1: Write the failing tests.** Append inside `describe("service", …)`. They reuse the `netInfo` and `drive` helpers from Task 5:

```js
  const setMsg = (extra = {}) => ({
    action: "setDeviceNetwork", mode: "static", currentIp: "10.0.0.7", wsPort: 81, id: "AABBCCDDEEFF",
    ip: "10.0.0.50", gw: "10.0.0.1", mask: "", dns: "", ...extra,
  });
  const saved = JSON.stringify({ type: "net", ok: true, msg: "saved", restartInMs: 1500 });

  test("setDeviceNetwork sends SET, re-finds the box at the new IP and saves it", async () => {
    const { service, storage, advance } = await setup();
    const sent = [];
    const res = await drive(service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); sent.push(...ws.sent); ws.receive(saved); },
      "ws://10.0.0.50:81/": (ws) => { ws.open(); ws.receive(netInfo({ ip: "10.0.0.50", mode: "static" })); },
    }, advance, 2000);
    assert.deepEqual(sent, ["CMD:NET:SET:10.0.0.50,10.0.0.1,255.255.255.0"]);
    assert.deepEqual(res, { ok: true, ip: "10.0.0.50", id: "AABBCCDDEEFF" });
    assert.equal(storage.local.data.deviceIp, "10.0.0.50");
    assert.equal(FakeWebSocket.last.url, "ws://10.0.0.50:81/");
  });

  test("setDeviceNetwork reports setup-closed and saves nothing", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(service.handleRuntimeMessage(setMsg()), {
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
    const res = await drive(service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(saved); },
    }, advance, 2000);
    assert.equal(res.ok, false);
    assert.match(res.error, /vẫn giữ IP mới/);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("setDeviceNetwork ignores a different box answering at the new IP", async () => {
    const { service, storage, advance } = await setup();
    const res = await drive(service.handleRuntimeMessage(setMsg()), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); ws.receive(saved); },
      "ws://10.0.0.50:81/": (ws) => { ws.open(); ws.receive(netInfo({ id: "OTHERBOX0000" })); },
    }, advance, 2000);
    assert.equal(res.ok, false);
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });

  test("setDeviceNetwork in DHCP mode sends CMD:NET:DHCP and asks to rescan", async () => {
    const { service, storage, advance } = await setup();
    const sent = [];
    const res = await drive(service.handleRuntimeMessage(setMsg({ mode: "dhcp", ip: "", gw: "" })), {
      "ws://10.0.0.7:81/": (ws) => { ws.open(); sent.push(...ws.sent); ws.receive(saved); },
    }, advance);
    assert.deepEqual(sent, ["CMD:NET:DHCP"]);
    assert.deepEqual(res, { ok: true, dhcp: true });
    assert.equal(storage.local.data.deviceIp, "10.0.0.5");
  });
```

Note: `drive` answers every new socket to a matching URL. For the success test, only the first re-find socket matters, because the promise settles right after it.

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd chrome-extension && node --test --test-timeout=20000 test/service.test.js`
Expected: FAIL with unknown action "setDeviceNetwork".

- [ ] **Step 3: Implement.** Update the imports in `service.js`:

```js
import { DEFAULTS, normalizeConfig, deviceUrl, isIPv4 } from "../lib/config.js";
import { NET_INFO_COMMAND, NET_DHCP_COMMAND, validateStaticNet, netSetCommand } from "../lib/net-config.js";
import { REASON_TEXT, NET_ERROR_TEXT } from "../lib/messages.js";
```

Add constants after `SCAN_TIMEOUT_MS`:

```js
const NET_REPLY_TIMEOUT_MS = 5000;
const REFIND_INTERVAL_MS = 2000;
const REFIND_TOTAL_MS = 40000;
```

Inside `createService`, after `saveDevice`:

```js
  const sleep = (ms) => new Promise((resolve) => setTimeoutFn(resolve, ms));

  // After CMD:NET:SET the box restarts; poll the new address until the same MAC answers.
  async function refind(ip, wsPort, id) {
    const deadline = now().getTime() + REFIND_TOTAL_MS;
    while (now().getTime() < deadline) {
      const r = await askBox(ip, wsPort, NET_INFO_COMMAND, SCAN_TIMEOUT_MS);
      if (r.ok && r.reply.id === id) return true;
      await sleep(REFIND_INTERVAL_MS);
    }
    return false;
  }
```

Add this case before `default:`:

```js
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

        const sent = await askBox(currentIp, wsPort, command, NET_REPLY_TIMEOUT_MS);
        if (!sent.ok) return { ok: false, error: `Không gửi được lệnh tới hộp ở ${currentIp} (hộp tắt, khác mạng, hoặc firmware cũ).` };
        if (!sent.reply.ok) return { ok: false, error: NET_ERROR_TEXT[sent.reply.error] ?? `Hộp từ chối: ${sent.reply.error}` };
        if (!net) return { ok: true, dhcp: true };

        await sleep(Number(sent.reply.restartInMs) || 0);
        if (!(await refind(net.ip, wsPort, id))) {
          return {
            ok: false,
            error: `Hộp đã lưu IP ${net.ip} nhưng chưa thấy hộp ở IP này. Kiểm tra IP/gateway có đúng dải mạng không; hộp vẫn giữ IP mới.`,
          };
        }
        await saveDevice(net.ip, wsPort);
        return { ok: true, ip: net.ip, id };
      }
```

- [ ] **Step 4: Run the full suite.**

Run: `cd chrome-extension && node --test --test-timeout=20000`
Expected: PASS, 0 fail.

- [ ] **Step 5: Commit.**

```bash
git add chrome-extension/src/background/service.js chrome-extension/test/service.test.js
git commit -m "feat(extension): setDeviceNetwork with re-find by MAC before saving"
```

---

### Task 7: Fake device supports `CMD:NET:*` + e2e tests

**Files:**
- Modify: `chrome-extension/tools/fake-device.mjs`
- Test: `chrome-extension/test/e2e-fake-device.test.js`

**Interfaces:**
- Consumes: service actions from Tasks 5–6.
- Produces:
  - `createFakeDevice({ id = "FAKEDEVICE00", setupOpen = true, … })`, with the getter `lastNetCommand` and the property `setupOpen` (settable).
  - `handleCommand(text, reply?)`, where `reply(obj)` sends JSON to the requesting client.
  - CLI flags `--id <MAC>` and `--setup-closed`.

- [ ] **Step 1: Write the failing e2e tests.** Append to `test/e2e-fake-device.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail.**

Run: `cd chrome-extension && node --test --test-timeout=60000 test/e2e-fake-device.test.js`
Expected: FAIL. No device is found (the fake ignores `CMD:NET:INFO`, so each probe times out); `d` is undefined.

- [ ] **Step 3: Implement in `tools/fake-device.mjs`.**
  - Header comment: change line 3 to `// firmware in simulation mode (same JSON, same CMD:SIM:* and CMD:NET:* commands).`, and line 6 to `//   node tools/fake-device.mjs [--port 81] [--host 0.0.0.0] [--id <MAC>] [--setup-closed]`.
  - `readingJson`: change `id: "FAKEDEVICE00",` to take the id. Change the signature to `function readingJson(header, value, unit = "g", id = "FAKEDEVICE00")` and use `id,` in the object.
  - `createFakeDevice` options: add `id = "FAKEDEVICE00",` and `setupOpen = true,`. After `const sim = …` add:

```js
  const net = { setupOpen, lastCommand: null };
```

  - In `currentReading()`, pass the id: `readingJson("OL", null, "g", id)`, `readingJson("US", displayed() + noise, "g", id)`, `readingJson("ST", displayed(), "g", id)`.
  - Add before `handleCommand`:

```js
  // CMD:NET:* like the firmware, except that SET cannot move the fake to another IP
  function handleNet(cmd, reply) {
    if (cmd === "CMD:NET:INFO") {
      reply({ type: "net", ok: true, device: "HR250A", id, ip: "127.0.0.1", mode: "dhcp", setupLeftSec: net.setupOpen ? 600 : 0, fw: "fake" });
    } else if (cmd !== "CMD:NET:DHCP" && !cmd.startsWith("CMD:NET:SET:")) {
      reply({ type: "net", ok: false, error: "bad-args" });
    } else if (!net.setupOpen) {
      reply({ type: "net", ok: false, error: "setup-closed" });
    } else {
      net.lastCommand = cmd;
      reply({ type: "net", ok: true, msg: "saved", restartInMs: 0 });
    }
    return true;
  }
```

  - Change `handleCommand` to take a reply callback, and route NET first:

```js
  function handleCommand(text, reply = (obj) => log(`[net] ${JSON.stringify(obj)}`)) {
    const cmd = String(text).trim().toUpperCase();
    if (cmd.startsWith("CMD:NET:")) {
      log(`[cmd] ${cmd}`);
      return handleNet(cmd, reply);
    }
    if (cmd === "Z" || cmd === "T") {
```

  (the rest of `handleCommand` is unchanged).
  - In the `upgrade` handler, change `if (f.opcode === 0x1) handleCommand(f.payload.toString("utf8"));` to:

```js
        if (f.opcode === 0x1) {
          handleCommand(f.payload.toString("utf8"), (obj) => sock.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj)))));
        }
```

  - In the returned object, add:

```js
    get lastNetCommand() {
      return net.lastCommand;
    },
    get setupOpen() {
      return net.setupOpen;
    },
    set setupOpen(v) {
      net.setupOpen = !!v;
    },
```

  - In `main()`, pass the flags into `createFakeDevice`:

```js
    id: opt("id", "FAKEDEVICE00"),
    setupOpen: !args.includes("--setup-closed"),
```

- [ ] **Step 4: Run the full suite.**

Run: `cd chrome-extension && node --test --test-timeout=60000`
Expected: PASS, 0 fail. The e2e scan covers 254 loopback addresses and should finish within a few seconds.

- [ ] **Step 5: Commit.**

```bash
git add chrome-extension/tools/fake-device.mjs chrome-extension/test/e2e-fake-device.test.js
git commit -m "test(extension): fake device answers CMD:NET:*, e2e scan and IP setup"
```

---

### Task 8: Firmware 0.4.0 — `CMD:NET:*` over WebSocket

**Files:**
- Modify: `config.h`, `HungDuyScaleHR250A.ino`, `commands.ino`, `ws_server.ino`

**Interfaces:**
- Produces: the WebSocket protocol exactly as specified in spec §2.2. This is what the Task 4–7 code and the fake device mirror.
- Serial `CMD:IP` / `CMD:IP:DHCP` behaviour and messages stay unchanged.

The firmware has no unit-test harness. Verification is a compile plus the real-board checklist in Step 7.

- [ ] **Step 1: `config.h`.** After the `// ============== Network ==============` block (after `HOSTNAME_PREFIX`), add:

```cpp
// ============== Network setup over WebSocket (CMD:NET:*) ==============
// SET/DHCP are accepted only during the first SETUP_WINDOW_MS after power-up, so
// changing the address needs physical access (power-cycle the box). INFO is always answered.
#define SETUP_WINDOW_MS       600000UL
#define NET_RESTART_DELAY_MS  1500UL    // reply first, restart from loop() afterwards
#define WS_CMD_MAX            96        // longest accepted WebSocket text command
```

In the forward declarations, add:

```cpp
bool    applyStaticIp(const String &args);
void    applyDhcp();
unsigned long setupWindowLeftSec();
```

In the extern globals, add:

```cpp
extern unsigned long restartAt;
```

- [ ] **Step 2: `HungDuyScaleHR250A.ino`.**
  - Change `String firmwareVer = "0.3.0";` to `String firmwareVer = "0.4.0";`.
  - After `bool   ethGotIP    = false;`, add `unsigned long restartAt = 0;   // millis() at which loop() restarts the ESP (0 = none)`.
  - At the top of `loop()`, before the USB serial `while`, add:

```cpp
  // Deferred restart after CMD:NET:SET/DHCP, so the WebSocket reply is sent first
  if (restartAt != 0 && (long)(millis() - restartAt) >= 0) {
    Serial.println("Restarting to apply network settings...");
    delay(100);
    ESP.restart();
  }
```

- [ ] **Step 3: `commands.ino`.** Add these functions above `handleSerialCommand`:

```cpp
// "<ip>,<gateway>[,<subnet>[,<dns>]]" → saved as static IP (takes effect after restart).
// Shared by CMD:IP (USB Serial) and CMD:NET:SET (WebSocket, setup window only).
bool applyStaticIp(const String &argsIn) {
  String args = argsIn;
  String parts[4];
  int n = 0;
  while (n < 4 && args.length() > 0) {
    int comma = args.indexOf(',');
    parts[n++] = (comma >= 0) ? args.substring(0, comma) : args;
    args = (comma >= 0) ? args.substring(comma + 1) : "";
    parts[n - 1].trim();
  }
  IPAddress tmp;
  bool ok = n >= 2 && tmp.fromString(parts[0]) && tmp.fromString(parts[1]) &&
            (n < 3 || tmp.fromString(parts[2])) && (n < 4 || tmp.fromString(parts[3]));
  if (!ok) return false;
  netStaticIP = true;
  netIP       = parts[0];
  netGateway  = parts[1];
  netSubnet   = (n >= 3) ? parts[2] : "255.255.255.0";
  netDNS      = (n >= 4) ? parts[3] : "";
  saveSettings();
  return true;
}

void applyDhcp() {
  netStaticIP = false;
  saveSettings();
}
```

Replace the two IP branches in `handleSerialCommand` with:

```cpp
  } else if (cmdUpper == "IP:DHCP") {
    applyDhcp();
    Serial.println("OK: DHCP. Send CMD:RESTART to apply");

  } else if (cmdUpper.startsWith("IP:")) {
    // CMD:IP:<ip>,<gateway>[,<subnet>[,<dns>]]
    if (applyStaticIp(cmd.substring(3))) {
      Serial.println("OK: static " + netIP + " gw " + netGateway + " mask " + netSubnet +
                     ". Send CMD:RESTART to apply");
    } else {
      Serial.println("ERR: Use CMD:IP:<ip>,<gateway>[,<subnet>[,<dns>]] or CMD:IP:DHCP");
    }
```

In the `STATUS` branch, after the `SIM:` line, add:

```cpp
    Serial.println("Setup: " + (setupWindowLeftSec() > 0 ? String(setupWindowLeftSec()) + " s left (CMD:NET:SET open)"
                                                         : String("closed until next power-up")));
```

In the `HELP` branch, before `Serial.println("  CMD:RESTART");`, add:

```cpp
    Serial.println("Network setup over WebSocket (used by the extension):");
    Serial.println("  CMD:NET:INFO       MAC, IP, DHCP/static, seconds left in the setup window");
    Serial.println("  CMD:NET:SET:<ip>,<gw>[,<mask>[,<dns>]]  |  CMD:NET:DHCP");
    Serial.println("                     only in the first 10 min after power-up; saves and restarts");
```

- [ ] **Step 4: `ws_server.ino`.**
  - Update the header comment, line 4: `// except "CMD:SIM:*" (simulator) and "CMD:NET:*" (network setup). Other CMD:* are Serial-only (no auth on LAN).`
  - After `static String lastReadingJson = "";`, add:

```cpp
static bool setupClosed = false;   // latched so a millis() wrap (~49.7 days) never reopens the window

unsigned long setupWindowLeftSec() {
  if (setupClosed) return 0;
  unsigned long now = millis();
  if (now >= SETUP_WINDOW_MS) {
    setupClosed = true;
    return 0;
  }
  return (SETUP_WINDOW_MS - now) / 1000;
}

// ---- CMD:NET:* — replies go to the requesting client only ----
static String netInfoJson() {
  String j = "{\"type\":\"net\",\"ok\":true";
  j += ",\"device\":\"" BAL_DEVICE_NAME "\"";
  j += ",\"id\":\"" + macAddress + "\"";
  j += ",\"ip\":\"" + (ethGotIP ? ETH.localIP().toString() : String("")) + "\"";
  j += ",\"mode\":\"" + String(netStaticIP ? "static" : "dhcp") + "\"";
  j += ",\"setupLeftSec\":" + String(setupWindowLeftSec());
  j += ",\"fw\":\"" + firmwareVer + "\"}";
  return j;
}

static String netErrorJson(const char *code) {
  return String("{\"type\":\"net\",\"ok\":false,\"error\":\"") + code + "\"}";
}

static String netSavedJson() {
  restartAt = millis() + NET_RESTART_DELAY_MS;
  if (restartAt == 0) restartAt = 1;
  return "{\"type\":\"net\",\"ok\":true,\"msg\":\"saved\",\"restartInMs\":" + String(NET_RESTART_DELAY_MS) + "}";
}

static void handleNetCommand(uint8_t num, const String &sub) {
  String upper = sub;
  upper.toUpperCase();
  String reply;
  if (upper == "INFO")                                   reply = netInfoJson();
  else if (upper != "DHCP" && !upper.startsWith("SET:")) reply = netErrorJson("bad-args");
  else if (setupWindowLeftSec() == 0)                    reply = netErrorJson("setup-closed");
  else if (upper == "DHCP")                              { applyDhcp(); reply = netSavedJson(); }
  else if (applyStaticIp(sub.substring(4)))              reply = netSavedJson();
  else                                                   reply = netErrorJson("bad-args");
  Serial.println("[WS] CMD:NET:" + sub + " -> " + reply);
  webSocket.sendTXT(num, reply);
}
```

  - In `onWsEvent`, change `if (cmd.length() == 0 || cmd.length() > 32) break;` to `if (cmd.length() == 0 || cmd.length() > WS_CMD_MAX) break;`, and add a branch between the `CMD:SIM:` and `CMD:` branches:

```cpp
      } else if (upper.startsWith("CMD:NET:")) {
        handleNetCommand(num, cmd.substring(8));
```

  - In `loopWebSocket()`, add `setupWindowLeftSec();   // keep the setup-window latch current` before `webSocket.loop();`.

- [ ] **Step 5: Review Focus #5 check.**
  - Read `setupWindowLeftSec()` once more and confirm that after `setupClosed` becomes `true` it can never return non-zero.
  - Confirm that `loopWebSocket()` calls it every loop, so the latch is set within milliseconds of the 10-minute mark even if no command arrives.

- [ ] **Step 6: Compile.** `arduino-cli` is not installed on this machine. Build in Arduino IDE instead: board WT32-ETH01, esp32 core 3.3.10, Partition No OTA, **Erase All Flash: Disabled** → Verify. Alternatively, install arduino-cli and run:

```
arduino-cli compile --fqbn esp32:esp32:wt32-eth01:PartitionScheme=no_ota .
```

Expected: compiles with 0 errors.

- [ ] **Step 7: Real-board checklist.** The owner runs this with the box on the LAN; the extension comes from Task 9 or `wscat` / browser devtools.
  1. Upload. Serial shows `=== HungDuyScaleHR250A v0.4.0 ===`; `CMD:STATUS` shows `Setup: 5xx s left`.
  2. From a PC, `new WebSocket("ws://<box-ip>:81/")` in the devtools console. Send `CMD:NET:INFO` and get the `type:"net"` reply with `id` `781C3CCA2FA7`.
  3. Within 10 minutes: send `CMD:NET:SET:<free-ip>,<gw>`. The reply arrives, the box restarts about 1.5 s later, and Serial shows `ETH IP: <free-ip> (static)`.
  4. After more than 10 minutes of uptime: `CMD:NET:SET:…` returns `setup-closed`; `CMD:STATUS` shows `Setup: closed until next power-up`.
  4b. Right after the SET-triggered restart in step 3: Serial shows `Setup window: closed (not a power-up…)`, and a second `CMD:NET:SET` returns `setup-closed`. Unplug and replug the power, and the window is open again. (This was added after the final review; see the ledger.)
  4c. **Scan in real Chrome:** put the box (or the fake device on a LAN IP) at a high host number such as .200–.254. Scan three times: the box must be found every time. If it is missed, lower `SCAN_LIMIT` (service.js) to 16 and/or raise `SCAN_TIMEOUT_MS` to 3000, then update "khoảng 10 giây" in the IT guide.
  5. `CMD:NET:DHCP` within 10 minutes of a fresh power-up returns the box to DHCP.
  6. Serial `CMD:IP:…` and `CMD:IP:DHCP` still print the same OK/ERR lines as 0.3.0.
  7. Test factory reset (IO2) after a static IP. This is the owner's pending test; report the result.

- [ ] **Step 8: Commit.**

```bash
git add config.h HungDuyScaleHR250A.ino commands.ino ws_server.ino
git commit -m "feat(firmware): v0.4.0 CMD:NET:INFO/SET/DHCP over WebSocket with 10-min setup window"
```

---

### Task 9: Options "Cài đặt hộp cân lần đầu" card + popup MAC + version bump

**Files:**
- Modify: `chrome-extension/src/options/options.html`, `chrome-extension/src/options/options.js`, `chrome-extension/src/options/options.css`
- Modify: `chrome-extension/src/popup/popup.js`
- Modify: `chrome-extension/manifest.json` (`"version": "1.1.0"`)

**Interfaces:**
- Consumes:
  - runtime actions `scanNetwork`, `useDevice`, `setDeviceNetwork` (Tasks 5–6);
  - `live.scan` in `chrome.storage.session`;
  - `formatMac` (Task 1);
  - `DEFAULT_PREFIX`, `prefixOf` (Task 2);
  - reading `id` (Task 3).

UI code has no automated tests in this repo (popup/options are thin). Verification is manual against the fake device in Step 6.

- [ ] **Step 1: `options.html`.** Insert this block right after the `<p class="muted">Extension nhận số cân…</p>` line:

```html
      <section class="card">
        <h2>Cài đặt hộp cân lần đầu</h2>
        <p class="muted">
          Máy tính và hộp cân phải cắm cùng mạng. Bấm <b>Tìm hộp cân</b>, đối chiếu MAC với nhãn dán trên hộp.
        </p>
        <div class="grid2">
          <div>
            <label for="scanPrefix">Dải mạng</label>
            <input type="text" id="scanPrefix" placeholder="172.16.10" autocomplete="off" />
          </div>
          <div>
            <label for="scanPort">Port</label>
            <input type="number" id="scanPort" min="1" max="65535" />
          </div>
        </div>
        <div class="row buttons">
          <button id="scanBtn" class="btn btn-primary">Tìm hộp cân</button>
          <span id="scanProgress" class="muted"></span>
        </div>
        <div id="scanResult" class="notice hidden"></div>
        <ul id="deviceList" class="device-list"></ul>

        <div id="netForm" class="hidden">
          <h2 class="section-gap">Đặt IP cố định cho hộp <span id="netTarget" class="muted"></span></h2>
          <div class="grid2">
            <div>
              <label for="netIp">IP mới của hộp</label>
              <input type="text" id="netIp" autocomplete="off" />
            </div>
            <div>
              <label for="netGw">Gateway</label>
              <input type="text" id="netGw" autocomplete="off" />
            </div>
            <div>
              <label for="netMask">Subnet mask</label>
              <input type="text" id="netMask" value="255.255.255.0" autocomplete="off" />
            </div>
            <div>
              <label for="netDns">DNS (không bắt buộc)</label>
              <input type="text" id="netDns" autocomplete="off" />
            </div>
          </div>
          <div class="hint">
            Chỉ đổi được trong 10 phút đầu sau khi cắm điện hộp. Hết giờ thì rút điện, cắm lại hộp rồi làm lại. Hộp sẽ khởi
            động lại; extension tự tìm hộp ở IP mới rồi mới lưu.
          </div>
          <div class="row buttons">
            <button id="netSaveBtn" class="btn btn-primary">Lưu IP vào hộp</button>
            <button id="netDhcpBtn" class="btn">Chuyển hộp về DHCP</button>
            <button id="netCloseBtn" class="btn">Đóng</button>
          </div>
          <div id="netResult" class="notice hidden"></div>
        </div>
      </section>
```

Also fix two stale texts in the existing "Kết nối hộp cân" card:
  - The hint under `deviceIp` becomes: `<div class="hint">IP ghi trên vỏ hộp. Chưa biết IP thì dùng <b>Tìm hộp cân</b> ở trên.</div>`
  - `<span class="muted">Kiểm tra dùng giá trị đang nhập, không tự lưu.</span>` becomes `<span class="muted">Kiểm tra &amp; lưu: chỉ lưu khi hộp trả về số cân.</span>`

- [ ] **Step 2: `options.css`.** Append:

```css
.device-list {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
}

.device-list li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--line);
}

.device-list .ip {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: `options.js`.** Change the imports at the top to:

```js
import { DEFAULTS, normalizeConfig } from "../lib/config.js";
import { DEFAULT_PREFIX, prefixOf } from "../lib/scan.js";
import { formatMac } from "../lib/net-config.js";
```

Insert this block before `// ── Init ──`:

```js
// ── First-time setup: scan, adopt IP, set static IP ───────────────────────────

let selected = null;

function reloadForm() {
  return chrome.storage.local.get(DEFAULTS).then((raw) => fillForm(normalizeConfig(raw).config));
}

function setupText(d) {
  if (d.legacy) return "firmware cũ, không đặt IP được";
  if (!d.canSetup) return "hết 10 phút cài đặt";
  return `còn ${Math.ceil(d.setupLeftSec / 60)} phút cài đặt`;
}

function renderDevices(devices) {
  const list = $("deviceList");
  list.replaceChildren();
  for (const d of devices) {
    const li = document.createElement("li");
    const ip = document.createElement("span");
    ip.className = "ip";
    ip.textContent = d.ip;
    const info = document.createElement("span");
    info.className = "muted";
    info.textContent = `MAC ${formatMac(d.id)} · ${d.mode === "static" ? "IP tĩnh" : d.mode === "dhcp" ? "DHCP" : "?"} · ${setupText(d)}`;
    const spacer = document.createElement("span");
    spacer.className = "spacer";

    const use = document.createElement("button");
    use.className = "btn";
    use.textContent = "Dùng IP này";
    use.addEventListener("click", () => useDevice(d, use));

    const set = document.createElement("button");
    set.className = "btn btn-primary";
    set.textContent = "Đặt IP cố định…";
    set.disabled = !d.canSetup;
    set.title = d.canSetup ? "" : setupText(d);
    set.addEventListener("click", () => openNetForm(d));

    li.append(ip, info, spacer, use, set);
    list.append(li);
  }
}

$("scanBtn").addEventListener("click", async () => {
  const btn = $("scanBtn");
  btn.disabled = true;
  $("scanResult").classList.add("hidden");
  $("deviceList").replaceChildren();
  $("scanProgress").textContent = "Đang quét…";
  try {
    const res = await send({ action: "scanNetwork", prefix: $("scanPrefix").value, wsPort: $("scanPort").value });
    if (!res.ok) return show("scanResult", false, res.error);
    renderDevices(res.devices);
    if (res.devices.length === 0) {
      show(
        "scanResult",
        false,
        `Không tìm thấy hộp cân nào trong dải ${$("scanPrefix").value.trim()}.1–254. Máy tính và hộp phải cùng mạng; hoặc nhập IP tay ở mục Kết nối hộp cân.`,
      );
    }
  } finally {
    btn.disabled = false;
    $("scanProgress").textContent = "";
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.live) return;
  const scan = changes.live.newValue?.scan;
  if (scan) $("scanProgress").textContent = `Đang quét… ${scan.done}/${scan.total}`;
});

async function useDevice(d, btn) {
  btn.disabled = true;
  try {
    const res = await send({ action: "useDevice", ip: d.ip, wsPort: d.wsPort });
    show("scanResult", res.ok, res.ok ? `Đã lưu IP ${res.ip} và đang kết nối. Ghi IP này lên vỏ hộp.` : res.error);
    if (res.ok) await reloadForm();
  } finally {
    btn.disabled = false;
  }
}

function openNetForm(d) {
  selected = d;
  $("netTarget").textContent = `(${d.ip}, MAC ${formatMac(d.id)})`;
  $("netIp").value = d.ip;
  $("netGw").value = "";
  $("netGw").placeholder = `${prefixOf(d.ip) ?? DEFAULT_PREFIX}.1`;
  $("netResult").classList.add("hidden");
  $("netForm").classList.remove("hidden");
  $("netGw").focus();
}

async function sendNet(mode) {
  if (!selected) return;
  const buttons = ["netSaveBtn", "netDhcpBtn", "netCloseBtn"].map($);
  buttons.forEach((b) => (b.disabled = true));
  show("netResult", true, mode === "dhcp" ? "Đang gửi lệnh…" : "Đang gửi… hộp sẽ khởi động lại, đợi tối đa 40 giây.");
  try {
    const res = await send({
      action: "setDeviceNetwork",
      mode,
      currentIp: selected.ip,
      wsPort: selected.wsPort,
      id: selected.id,
      ip: $("netIp").value,
      gw: $("netGw").value,
      mask: $("netMask").value,
      dns: $("netDns").value,
    });
    if (!res.ok) return show("netResult", false, res.error);
    if (res.dhcp) {
      show("netResult", true, "Hộp đang khởi động lại với DHCP. Đợi khoảng 10 giây rồi bấm Tìm hộp cân.");
    } else {
      show("netResult", true, `Đã đặt IP ${res.ip} cho hộp và lưu vào extension. Ghi IP này lên vỏ hộp.`);
      await reloadForm();
    }
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

$("netSaveBtn").addEventListener("click", () => sendNet("static"));
$("netDhcpBtn").addEventListener("click", () => sendNet("dhcp"));
$("netCloseBtn").addEventListener("click", () => {
  selected = null;
  $("netForm").classList.add("hidden");
});
```

Replace the last line (the `// ── Init ──` body) with:

```js
chrome.storage.local.get(DEFAULTS).then((raw) => {
  const { config } = normalizeConfig(raw);
  fillForm(config);
  $("scanPrefix").value = prefixOf(config.deviceIp) ?? DEFAULT_PREFIX;
  $("scanPort").value = config.wsPort;
});
```

- [ ] **Step 4: `popup.js`.**
  - Add the import `import { formatMac } from "../lib/net-config.js";`.
  - In `renderLive()`, move `const r = live?.lastReading;` above the `deviceAddr` line.
  - Change the `deviceAddr` line to:

```js
  $("deviceAddr").textContent = hasIp ? `${config.deviceIp}:${config.wsPort}${r?.id ? ` · MAC ${formatMac(r.id)}` : ""}` : "Chưa có IP";
```

  - Remove the now-duplicate `const r = live?.lastReading;` further down.

- [ ] **Step 5: `manifest.json`.** Change `"version": "1.0.0"` to `"version": "1.1.0"`.

- [ ] **Step 6: Manual check against the fake device.**
  1. `cd chrome-extension && node tools/fake-device.mjs --port 8181 --id 781C3CCA2FA7`
  2. Chrome → `chrome://extensions` → Reload the unpacked extension → open ⚙ Options.
  3. Set Dải mạng `127.0.0`, Port `8181` → **Tìm hộp cân**. Expected: the progress counts up to 254/254, and one row appears: `127.0.0.1 · MAC 78:1C:3C:CA:2F:A7 · DHCP · còn 10 phút cài đặt`.
  4. **Dùng IP này** → green notice. The "Kết nối hộp cân" form now shows `127.0.0.1` / `8181`. The popup footer shows `127.0.0.1:8181 · MAC 78:1C:3C:CA:2F:A7`.
  5. **Đặt IP cố định…** with gateway `127.0.0.2` → **Lưu IP vào hộp** → the success notice appears. The fake console prints `[cmd] CMD:NET:SET:127.0.0.1,127.0.0.2,255.255.255.0`.
  6. Gateway `127.0.1.1` → red notice "IP và gateway phải cùng dải mạng…", and nothing is printed in the fake console.
  7. Restart the fake with `--setup-closed`, scan again → the row says "hết 10 phút cài đặt" and "Đặt IP cố định…" is disabled.
  8. `node --test --test-timeout=60000` still passes.

- [ ] **Step 7: Commit.**

```bash
git add chrome-extension/src/options chrome-extension/src/popup/popup.js chrome-extension/manifest.json
git commit -m "feat(extension): v1.1.0 first-time setup card (scan, use IP, set static IP)"
```

---

### Task 10: Handoff docs, box label, project docs

**Files:**
- Create: `docs/huong-dan-setup-cho-IT.md`
- Modify: `and_hr250a_rs232_esp32.md` (§6.2), `NOTES.md`, `chrome-extension/README.md`, `CLAUDE.md`

- [ ] **Step 1: Create `docs/huong-dan-setup-cho-IT.md`** with this content:

````markdown
# Hướng dẫn cài đặt hộp cân HR-250A (dành cho IT nhà máy)

Không cần Serial Monitor. Chỉ cần: cân HR-250A, hộp cân (ESP32 WT32-ETH01), máy tính Windows có Chrome, và extension **Cân HR-250A**.

## Thông tin trên nhãn hộp

| Hộp | MAC | Hostname |
|---|---|---|
| #1 | `78:1C:3C:CA:2F:A7` | `hdscale-hr250a-CA2FA7` |

## 1. Cắm hộp
1. Cắm dây mạng từ hộp vào switch của nhà máy (mạng phải cấp IP tự động, DHCP).
2. Cắm nguồn 5V cho hộp. Từ lúc này có **10 phút** để đặt IP (xem mục 4). Hết 10 phút thì rút nguồn cắm lại.

## 2. Cài extension
1. Chrome → `chrome://extensions` → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `chrome-extension`.
3. Ghim biểu tượng **Cân HR-250A** lên thanh công cụ.

## 3. Tìm hộp cân
1. Bấm biểu tượng extension → ⚙ (Cài đặt).
2. Mục **Cài đặt hộp cân lần đầu**: kiểm tra **Dải mạng** (3 số đầu IP của máy tính, ví dụ `172.16.10`), Port `81`.
3. Bấm **Tìm hộp cân**, đợi quét xong (khoảng 10 giây).
4. Đối chiếu **MAC** trong danh sách với nhãn trên hộp.

Chọn **một** trong hai cách dưới để giữ IP cố định cho hộp.

## 4a. Cách A: giữ IP trên router (khuyên dùng nếu IT quản lý router)
1. Trên router/DHCP server: giữ cố định (DHCP reservation) IP mong muốn cho MAC của hộp.
2. Rút nguồn hộp, cắm lại, đợi 10 giây.
3. Extension → **Tìm hộp cân** → dòng của hộp → **Dùng IP này**.

## 4b. Cách B: đặt IP tĩnh ngay trên hộp
1. Trong 10 phút đầu sau khi cắm nguồn: dòng của hộp → **Đặt IP cố định…**.
2. Nhập **IP mới** (phải trống, nằm ngoài dải router tự cấp), **Gateway**, Subnet mask (thường `255.255.255.0`), DNS (có thể bỏ trống).
3. Bấm **Lưu IP vào hộp**. Hộp khởi động lại; extension tự tìm hộp ở IP mới và lưu (tối đa 40 giây).

## 5. Hoàn tất
1. **Ghi IP lên vỏ hộp.**
2. Popup extension hiện **Đã kết nối**, số cân hiện khi đặt mẫu lên cân.
3. Các máy tính khác dùng cân: cài extension → ⚙ → nhập IP ở mục **Kết nối hộp cân** → **Kiểm tra & lưu**.

## Xử lý sự cố
| Hiện tượng | Cách xử lý |
|---|---|
| Không tìm thấy hộp | Máy tính và hộp phải cùng dải mạng; kiểm tra đèn cổng mạng của hộp; đúng Dải mạng / Port 81 |
| "Hết 10 phút cài đặt" | Rút nguồn hộp, cắm lại, làm lại trong 10 phút |
| "Hộp đã lưu IP … nhưng chưa thấy hộp" | IP/gateway nhập sai dải. Rút nguồn cắm lại; nếu vẫn không tìm thấy, liên hệ bộ phận IoT (đặt lại qua cổng USB) |
| "firmware cũ, không đặt IP được" | Hộp chưa được nạp firmware 0.4.0: liên hệ bộ phận IoT |
````

- [ ] **Step 2: `and_hr250a_rs232_esp32.md` §6.2.**
  - Insert right under the section intro paragraph (before `#### Cách 1`):

```markdown
#### Cài từ extension (không cần Serial Monitor)

Cần firmware ≥ 0.4.0 và extension ≥ 1.1.0. Trong ⚙ của extension, mục **Cài đặt hộp cân lần đầu** → **Tìm hộp cân**:
- Đã giữ IP trên router (cách 1): bấm **Dùng IP này**.
- Muốn đặt IP tĩnh (cách 2): trong 10 phút đầu sau khi cắm điện hộp, bấm **Đặt IP cố định…** → **Lưu IP vào hộp**.

Hướng dẫn từng bước cho IT: `docs/huong-dan-setup-cho-IT.md`. Hai cách dưới đây là cách làm qua Serial Monitor (cho người có cáp USB-TTL).
```
  - In the command table (§6.3), add a row: `| CMD:NET:INFO / CMD:NET:SET:… / CMD:NET:DHCP | Chỉ qua WebSocket (extension dùng). SET/DHCP chỉ trong 10 phút đầu sau khi cắm điện |`.

- [ ] **Step 3: `NOTES.md`.**
  - Add a row to "Đã xong và đã kiểm tra": `| Setup IP từ extension (firmware 0.4.0 + extension 1.1.0) | ✅ code + test | npm test; checklist board thật ở plan Task 8 Step 7 |`. Update it to ✅ board thật once Step 7 passes.
  - Replace the DHCP reservation TODO with: `- [ ] **Giao hộp cho IT:** nạp firmware 0.4.0, dán nhãn MAC 78:1C:3C:CA:2F:A7 / hdscale-hr250a-CA2FA7, gửi kèm docs/huong-dan-setup-cho-IT.md.`
  - Add: `- [ ] **Test nút reset IO2** sau khi đặt IP tĩnh (chủ dự án tự test, báo kết quả).`

- [ ] **Step 4: `chrome-extension/README.md`.** In the install section, after step 3, add: `Chưa biết IP của hộp: dùng mục **Cài đặt hộp cân lần đầu** → **Tìm hộp cân** (xem docs/huong-dan-setup-cho-IT.md).` In the test table (`| File | Kiểm tra |`), append to the existing cells, separated by `; `:
  - `test/lib.test.js`: `kiểm tra IP/gateway/mask trước khi đặt IP, dải mạng quét, pool quét song song, message CMD:NET`
  - `test/connection.test.js`: `netRequest (trả lời net, bỏ qua reading đến trước, firmware cũ, hết giờ, lỗi)`
  - `test/service.test.js`: `scanNetwork, useDevice, setDeviceNetwork (thành công, hết 10 phút, nhập sai, không thấy ở IP mới, MAC khác, DHCP)`
  - `test/e2e-fake-device.test.js`: `quét 127.0.0.x thấy fake device, đặt IP, hết 10 phút`

- [ ] **Step 5: `CLAUDE.md`.**
  - Header: `**Firmware:** 0.4.0` and `**Extension:** 1.1.0`.
  - Firmware behaviours:
    - Change "longer than 32 chars" to "longer than 96 chars (`WS_CMD_MAX`)".
    - Change the `CMD:*` rejection bullet to: `CMD:SIM:*` → simulator; `CMD:NET:*` → network setup (below); other `CMD:*` are rejected.
  - Add a `## Network setup (CMD:NET:*, WebSocket only)` section. It should state:
    - INFO is always answered.
    - SET/DHCP are answered only within `SETUP_WINDOW_MS` (10 min) after power-up, with a latch against a `millis()` wrap.
    - Replies are `{"type":"net",…}` to the requesting client only.
    - Restart is deferred via `restartAt` (1500 ms).
    - `applyStaticIp()` / `applyDhcp()` in `commands.ino` are shared with Serial `CMD:IP`.
  - Extension section:
    - Add `net-config.js` and `scan.js` to the `src/lib/` list, and `netRequest()` to `connection.js`.
    - Add runtime messages `scanNetwork`, `useDevice`, `setDeviceNetwork` (it re-finds the box by MAC at the new IP before saving).
    - Readings now carry `id`/`device`.
  - Fake device: it now answers `CMD:NET:*` (`--id`, `--setup-closed`); SET cannot move its IP.
  - Docs list: add `docs/huong-dan-setup-cho-IT.md` and the spec/plan paths.

- [ ] **Step 6: Final verification.**

Run: `cd chrome-extension && node --test --test-timeout=60000`
Expected: PASS, 0 fail. Re-read `docs/huong-dan-setup-cho-IT.md` start to finish as if you were IT: every button name must match `options.html` exactly ("Tìm hộp cân", "Dùng IP này", "Đặt IP cố định…", "Lưu IP vào hộp", "Kiểm tra & lưu").

- [ ] **Step 7: Commit.**

```bash
git add docs/huong-dan-setup-cho-IT.md and_hr250a_rs232_esp32.md NOTES.md chrome-extension/README.md CLAUDE.md
git commit -m "docs: IT setup guide without Serial Monitor, box label, v0.4.0/v1.1.0 notes"
```
