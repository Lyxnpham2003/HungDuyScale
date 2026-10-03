// Persistent WebSocket to the balance gateway with auto-reconnect.
// All I/O (WebSocket class, timers) is injected so it can be tested with fakes.

import { createBackoff } from "../lib/backoff.js";
import { parseDeviceMessage, parseNetMessage, DEVICE_NAME } from "../lib/reading.js";

const WS_CONNECTING = 0;
const WS_OPEN = 1;

export function createConnection({
  WebSocketImpl,
  getUrl, // () => "ws://ip:port/" | null
  onMessage, // (text) => void
  onStatus = () => {}, // ("connecting" | "connected" | "reconnecting" | "disconnected", extra?) => void
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  backoff = createBackoff(),
}) {
  let ws = null;
  let retryTimer = null;
  let wanted = false;

  function clearRetry() {
    if (retryTimer !== null) {
      clearTimeoutFn(retryTimer);
      retryTimer = null;
    }
  }

  // Close the current socket without triggering the reconnect logic
  function detach() {
    if (!ws) return;
    const sock = ws;
    ws = null;
    sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null;
    try {
      sock.close();
    } catch {}
  }

  function scheduleRetry() {
    if (retryTimer !== null || !wanted) return;
    retryTimer = setTimeoutFn(() => {
      retryTimer = null;
      if (wanted) open();
    }, backoff.next());
  }

  function open() {
    clearRetry();
    detach();
    const url = getUrl();
    if (!url) {
      onStatus("disconnected", { error: "Chưa cấu hình IP của hộp cân." });
      return;
    }
    onStatus("connecting");

    let sock;
    try {
      sock = new WebSocketImpl(url);
    } catch {
      onStatus("reconnecting");
      scheduleRetry();
      return;
    }
    ws = sock;

    sock.onopen = () => {
      if (ws !== sock) return;
      backoff.reset();
      onStatus("connected");
    };
    sock.onmessage = (e) => {
      if (ws === sock) onMessage(e.data);
    };
    sock.onerror = () => {
      try {
        sock.close();
      } catch {}
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      if (wanted) {
        onStatus("reconnecting");
        scheduleRetry();
      } else {
        onStatus("disconnected");
      }
    };
  }

  return {
    start() {
      wanted = true;
      backoff.reset();
      open();
    },
    stop() {
      wanted = false;
      clearRetry();
      detach();
      onStatus("disconnected");
    },
    // Keepalive backstop: reopen if we want a connection but have none and no retry pending
    ensure() {
      if (!wanted || retryTimer !== null) return;
      if (ws && (ws.readyState === WS_CONNECTING || ws.readyState === WS_OPEN)) return;
      open();
    },
    send(text) {
      if (ws && ws.readyState === WS_OPEN) {
        ws.send(text);
        return true;
      }
      return false;
    },
    isOpen() {
      return !!ws && ws.readyState === WS_OPEN;
    },
  };
}

// One-shot check used by "Kiểm tra & lưu": succeeds on the first valid reading.
export function probeDevice({ WebSocketImpl, url, timeoutMs, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
  return new Promise((resolve) => {
    let sock;
    let opened = false;
    let settled = false;

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

    const timer = setTimeoutFn(() => {
      finish({
        ok: false,
        error: opened
          ? "Đã kết nối nhưng không nhận được số cân (cân tắt, hoặc ESP chưa ở chế độ hỏi cân?)."
          : "Hết thời gian chờ, không kết nối được tới hộp cân.",
      });
    }, timeoutMs);

    try {
      sock = new WebSocketImpl(url);
    } catch {
      finish({ ok: false, error: "Không kết nối được tới hộp cân (địa chỉ sai?)." });
      return;
    }
    sock.onopen = () => {
      opened = true;
    };
    sock.onmessage = (e) => {
      const reading = parseDeviceMessage(e.data);
      if (reading) finish({ ok: true, reading });
    };
    sock.onerror = () => finish({ ok: false, error: "Không kết nối được tới hộp cân." });
    sock.onclose = () => finish({ ok: false, error: "Không kết nối được tới hộp cân (kết nối bị đóng)." });
  });
}

// One-shot CMD:NET:* exchange (scanner and IP setup). Sends `command` on open and
// resolves with the first {"type":"net"} reply. Fresh polled readings that arrive
// first are skipped, but remembered: a box that only
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
