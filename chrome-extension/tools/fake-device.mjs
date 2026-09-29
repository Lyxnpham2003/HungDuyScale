#!/usr/bin/env node
// Fake HungDuyScaleHR250A gateway: a WebSocket server that behaves like the
// firmware in simulation mode (same JSON, same CMD:SIM:* and CMD:NET:* commands).
// No dependencies — the WebSocket handshake/framing is implemented here.
//
//   node tools/fake-device.mjs [--port 81] [--host 0.0.0.0] [--id <MAC>] [--setup-closed]
//
// Then point the extension at 127.0.0.1:<port>. Type "help" for console commands.

import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// ── A&D line + firmware JSON (mirrors formatAndLine() / readingToJson()) ─────

export function formatAndLine(header, value, unit = "g") {
  if (header === "OL") return "OL,+9999999E+19";
  const sign = value < 0 ? "-" : "+";
  return `${header},${sign}${Math.abs(value).toFixed(4).padStart(10, "0")}${unit.padStart(3)}`;
}

function readingJson(header, value, unit = "g", id = "FAKEDEVICE00") {
  const hasValue = value !== null;
  const text = hasValue ? value.toFixed(4) : "";
  return JSON.stringify({
    type: "reading",
    device: "HR250A",
    id,
    header,
    stable: header === "ST",
    unstable: header === "US",
    overload: header === "OL",
    counting: false,
    count: null,
    value: hasValue ? Number(text) : null,
    unit,
    weight: hasValue ? `${text} ${unit}` : "",
    raw: formatAndLine(header, value, unit),
    uptime: Math.round(performance.now()),
    sim: true,
  });
}

// ── Minimal WebSocket framing ─────────────────────────────────────────────────

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// Parses complete client frames from buf; returns { frames, rest }
function decodeFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 2) {
    const b0 = buf[off];
    const b1 = buf[off + 1];
    let len = b1 & 0x7f;
    let pos = off + 2;
    if (len === 126) {
      if (buf.length < pos + 2) break;
      len = buf.readUInt16BE(pos);
      pos += 2;
    } else if (len === 127) {
      if (buf.length < pos + 8) break;
      len = Number(buf.readBigUInt64BE(pos));
      pos += 8;
    }
    const masked = (b1 & 0x80) !== 0;
    const maskLen = masked ? 4 : 0;
    if (buf.length < pos + maskLen + len) break;
    const mask = masked ? buf.subarray(pos, pos + 4) : null;
    pos += maskLen;
    const payload = Buffer.from(buf.subarray(pos, pos + len));
    if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    frames.push({ opcode: b0 & 0x0f, payload });
    off = pos + len;
  }
  return { frames, rest: buf.subarray(off) };
}

// ── Fake device ───────────────────────────────────────────────────────────────

export function createFakeDevice({
  port = 81,
  host = "0.0.0.0",
  tickMs = 500, // firmware polls "Q" every 500 ms
  settleMs = 2000,
  autoLoadedMs = 8000,
  autoEmptyMs = 5000,
  random = Math.random,
  id = "FAKEDEVICE00",
  setupOpen = true,
  log = () => {},
} = {}) {
  const clients = new Set();
  const sim = { enabled: true, target: 0, tare: 0, settleUntil: 0, overload: false, auto: false };
  const net = { setupOpen, lastCommand: null };
  let tickTimer = null;
  let autoTimer = null;

  const displayed = () => sim.target - sim.tare;

  function currentReading() {
    if (sim.overload) return readingJson("OL", null, "g", id);
    if (Date.now() < sim.settleUntil) {
      const noise = Math.round((random() - 0.5) * 100) / 10000; // ±0.005 g
      return readingJson("US", displayed() + noise, "g", id);
    }
    return readingJson("ST", displayed(), "g", id);
  }

  function broadcast(text) {
    const frame = encodeFrame(0x1, Buffer.from(text));
    for (const sock of clients) sock.write(frame);
  }

  function put(g) {
    sim.overload = false;
    sim.target = sim.tare + g;
    sim.settleUntil = Date.now() + settleMs;
  }

  function remove() {
    sim.overload = false;
    sim.target = 0;
    sim.tare = 0;
    sim.settleUntil = Date.now() + settleMs;
  }

  function scheduleAuto(loaded) {
    clearTimeout(autoTimer);
    if (!sim.auto) return;
    autoTimer = setTimeout(() => {
      if (loaded) remove();
      else put(Math.round((1 + random() * 199) * 10000) / 10000);
      scheduleAuto(!loaded);
    }, loaded ? autoLoadedMs : autoEmptyMs);
  }

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

  // Same command set as the firmware (WebSocket text or console)
  function handleCommand(text, reply = (obj) => log(`[net] ${JSON.stringify(obj)}`)) {
    const cmd = String(text).trim().toUpperCase();
    if (cmd.startsWith("CMD:NET:")) {
      log(`[cmd] ${cmd}`);
      return handleNet(cmd, reply);
    }
    if (cmd === "Z" || cmd === "T") {
      sim.tare = sim.target;
      sim.overload = false;
    } else if (cmd === "CMD:SIM:ON") {
      sim.enabled = true;
    } else if (cmd === "CMD:SIM:OFF") {
      sim.enabled = false;
      sim.auto = false;
      clearTimeout(autoTimer);
    } else if (cmd.startsWith("CMD:SIM:PUT:")) {
      const g = Number(cmd.slice(12));
      if (!Number.isFinite(g)) return false;
      put(g);
    } else if (cmd === "CMD:SIM:REMOVE") {
      remove();
    } else if (cmd === "CMD:SIM:OL") {
      sim.overload = true;
    } else if (cmd === "CMD:SIM:AUTO:ON") {
      sim.auto = true;
      put(Math.round((1 + random() * 199) * 10000) / 10000);
      scheduleAuto(true);
    } else if (cmd === "CMD:SIM:AUTO:OFF") {
      sim.auto = false;
      clearTimeout(autoTimer);
    } else if (cmd === "Q" || cmd === "S" || cmd === "SI") {
      // readings are emitted continuously
    } else {
      return false;
    }
    log(`[cmd] ${cmd}`);
    return true;
  }

  const server = http.createServer((_req, res) => {
    res.writeHead(426, { "Content-Type": "text/plain" });
    res.end("WebSocket only\n");
  });

  server.on("upgrade", (req, sock) => {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      sock.destroy();
      return;
    }
    const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    clients.add(sock);
    log(`[ws] client connected (${clients.size})`);
    if (sim.enabled) sock.write(encodeFrame(0x1, Buffer.from(currentReading())));

    let pending = Buffer.alloc(0);
    sock.on("data", (chunk) => {
      const { frames, rest } = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const f of frames) {
        if (f.opcode === 0x1) {
          handleCommand(f.payload.toString("utf8"), (obj) => sock.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj)))));
        }
        else if (f.opcode === 0x9) sock.write(encodeFrame(0xa, f.payload));
        else if (f.opcode === 0x8) {
          sock.end(encodeFrame(0x8, Buffer.alloc(0)));
          clients.delete(sock);
        }
      }
    });
    const drop = () => {
      if (clients.delete(sock)) log(`[ws] client disconnected (${clients.size})`);
    };
    sock.on("close", drop);
    sock.on("error", drop);
  });

  return {
    start() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          tickTimer = setInterval(() => {
            if (sim.enabled && clients.size) broadcast(currentReading());
          }, tickMs);
          resolve(server.address().port);
        });
      });
    },
    stop() {
      clearInterval(tickTimer);
      clearTimeout(autoTimer);
      for (const sock of clients) sock.destroy();
      clients.clear();
      return new Promise((resolve) => server.close(() => resolve()));
    },
    handleCommand,
    get lastNetCommand() {
      return net.lastCommand;
    },
    get setupOpen() {
      return net.setupOpen;
    },
    set setupOpen(v) {
      net.setupOpen = !!v;
    },
    get clientCount() {
      return clients.size;
    },
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const CONSOLE_HELP = `Lệnh:
  put <g>     đặt mẫu (vd: put 12.3456)     remove   nhấc mẫu
  ol          quá tải                        z / t    về 0 / trừ bì
  auto on|off tự lặp đặt/nhấc                on / off bật/tắt mô phỏng (tắt = như cân không gửi gì)
  help        hiện trợ giúp                  exit     thoát`;

function consoleToCommand(line) {
  const [word, arg] = line.trim().split(/\s+/);
  switch ((word || "").toLowerCase()) {
    case "put": return `CMD:SIM:PUT:${arg}`;
    case "remove": return "CMD:SIM:REMOVE";
    case "ol": return "CMD:SIM:OL";
    case "z": return "Z";
    case "t": return "T";
    case "auto": return arg === "off" ? "CMD:SIM:AUTO:OFF" : "CMD:SIM:AUTO:ON";
    case "on": return "CMD:SIM:ON";
    case "off": return "CMD:SIM:OFF";
    default: return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const device = createFakeDevice({
    port: Number(opt("port", 81)),
    host: opt("host", "0.0.0.0"),
    id: opt("id", "FAKEDEVICE00"),
    setupOpen: !args.includes("--setup-closed"),
    log: (m) => console.log(m),
  });
  const port = await device.start();

  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4").map((i) => i.address);
  console.log(`Fake HR-250A gateway đang chạy, port ${port}. Trỏ extension tới một trong các địa chỉ:`);
  for (const ip of ips) console.log(`  ws://${ip}:${port}/`);
  console.log(CONSOLE_HELP);

  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    const word = line.trim().toLowerCase();
    if (word === "help") return console.log(CONSOLE_HELP);
    if (word === "exit" || word === "quit") {
      await device.stop();
      process.exit(0);
    }
    const cmd = consoleToCommand(line);
    if (!cmd || !device.handleCommand(cmd)) console.log('Không hiểu lệnh. Gõ "help".');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.code === "EACCES" || e.code === "EADDRINUSE" ? `Không mở được port: ${e.message}` : e);
    process.exit(1);
  });
}
