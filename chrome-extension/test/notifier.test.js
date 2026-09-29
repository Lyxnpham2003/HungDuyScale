import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createNotifier, pageCall } from "../src/background/notifier.js";

function fakeChrome({ tabs = [], focusedWindowId = 1, execResult = "ok", execThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    tabs: { query: async (q) => (calls.push(["query", q]), tabs) },
    windows: { getLastFocused: async () => ({ id: focusedWindowId }) },
    scripting: {
      executeScript: async (opts) => {
        calls.push(["exec", opts]);
        if (execThrows) throw new Error("Cannot access contents of the page");
        return [{ result: execResult }];
      },
    },
  };
}

const qlcl = (id, extra = {}) => ({ id, url: `https://qlcl.hungduy.vn/p${id}`, windowId: 1, active: false, lastAccessed: id, ...extra });

describe("notifier", () => {
  test("injects into exactly one tab in the MAIN world", async () => {
    const c = fakeChrome({ tabs: [qlcl(1), qlcl(2, { active: true })] });
    const notify = createNotifier(c);
    const res = await notify({ valueText: "1.0000" });
    assert.deepEqual(res, { ok: true, tabId: 2 });
    const execs = c.calls.filter(([k]) => k === "exec");
    assert.equal(execs.length, 1);
    assert.equal(execs[0][1].world, "MAIN");
    assert.deepEqual(execs[0][1].target, { tabId: 2 });
    assert.deepEqual(execs[0][1].args, ["HR250A_onData", { valueText: "1.0000" }]);
  });

  test("queries only the qlcl URL patterns by default", async () => {
    const c = fakeChrome({ tabs: [] });
    await createNotifier(c)({});
    assert.deepEqual(c.calls[0][1].url, ["http://qlcl.hungduy.vn/*", "https://qlcl.hungduy.vn/*"]);
  });

  test("uses the given host list (localhost allowed)", async () => {
    const local = { id: 5, url: "https://localhost:7008/", windowId: 1, active: true };
    const c = fakeChrome({ tabs: [local] });
    const res = await createNotifier(c)({}, ["qlcl.hungduy.vn", "localhost"]);
    assert.deepEqual(res, { ok: true, tabId: 5 });
    assert.deepEqual(c.calls[0][1].url, [
      "http://qlcl.hungduy.vn/*", "https://qlcl.hungduy.vn/*", "http://localhost/*", "https://localhost/*",
    ]);
  });

  test("reports no-tab when qlcl is not open", async () => {
    const res = await createNotifier(fakeChrome({ tabs: [] }))({});
    assert.deepEqual(res, { ok: false, reason: "no-tab" });
  });

  test("reports no-handler when the page lacks window.HR250A_onData", async () => {
    const res = await createNotifier(fakeChrome({ tabs: [qlcl(1)], execResult: "no-handler" }))({});
    assert.deepEqual(res, { ok: false, reason: "no-handler", tabId: 1 });
  });

  test("reports handler-error when the page callback throws", async () => {
    const res = await createNotifier(fakeChrome({ tabs: [qlcl(1)], execResult: "error" }))({});
    assert.deepEqual(res, { ok: false, reason: "handler-error", tabId: 1 });
  });

  test("reports inject-failed when executeScript throws", async () => {
    const res = await createNotifier(fakeChrome({ tabs: [qlcl(1)], execThrows: true }))({});
    assert.deepEqual(res, { ok: false, reason: "inject-failed", tabId: 1 });
  });
});

describe("pageCall (runs inside the page)", () => {
  test("calls the callback with the payload", () => {
    const got = [];
    globalThis.window = { HR250A_onData: (d) => got.push(d) };
    assert.equal(pageCall("HR250A_onData", { v: 1 }), "ok");
    assert.deepEqual(got, [{ v: 1 }]);
  });

  test("returns no-handler / error instead of throwing", () => {
    const origWarn = console.warn, origErr = console.error;
    console.warn = console.error = () => {};
    try {
      globalThis.window = {};
      assert.equal(pageCall("HR250A_onData", {}), "no-handler");
      globalThis.window = { HR250A_onData: () => { throw new Error("boom"); } };
      assert.equal(pageCall("HR250A_onData", {}), "error");
    } finally {
      console.warn = origWarn;
      console.error = origErr;
      delete globalThis.window;
    }
  });
});
