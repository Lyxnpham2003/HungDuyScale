// Test doubles shared by the background tests.

export class FakeWebSocket {
  static instances = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }
  static reset() {
    FakeWebSocket.instances = [];
  }
  static get last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  // --- driven by the test ---
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(data) {
    this.onmessage?.({ data });
  }
  drop() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  fail() {
    this.onerror?.();
  }

  // --- WebSocket API used by the code ---
  send(text) {
    this.sent.push(text);
  }
  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

// Deterministic setTimeout/clearTimeout with a manual clock.
export function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    tick(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...pending.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        pending.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    get pendingCount() {
      return pending.size;
    },
    now: () => now,
  };
}

// In-memory chrome.storage.local / .session with get(defaults) / set(obj).
export function createFakeStorageArea(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(defaults) {
      if (defaults === null || defaults === undefined) return { ...data };
      if (typeof defaults === "string") return defaults in data ? { [defaults]: data[defaults] } : {};
      const out = {};
      for (const [k, v] of Object.entries(defaults)) out[k] = k in data ? data[k] : v;
      return out;
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
  };
}

export const flush = () => new Promise((r) => setImmediate(r));
