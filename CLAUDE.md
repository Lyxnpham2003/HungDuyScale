# CLAUDE.md

Gateway for an **A&D HR-250A** analytical balance. The ESP32 firmware reads the balance over RS-232C (via a MAX3232) and serves each reading as JSON over a WebSocket on Ethernet. The Chrome extension (`chrome-extension/`) then pushes the reading into the QuanLyChatLuong web (`qlcl.hungduy.vn`). All `.ino` files compile together as one Arduino sketch.

**Target hardware:** ESP32 WT32-ETH01 v1.4 · **Firmware:** 0.4.0 (`firmwareVer`, `HungDuyScaleHR250A.ino`) · **Extension:** 1.1.0 (`manifest.json`)

- The sibling project `../HungDuyScale` (XK3118T20 → BLE → mobile app) is kept separate on purpose. Do not merge the two.
- `D:\work_hung_duy\hung_duy_iot\extension\` (`../extension/`) holds TI TECH's original extensions for reference only; do not modify them.
  - `ChromeExtension/EK-610i/` is the closest model: the same WebSocket `ws://<ip>:81/` gateway contract.
  - The others are `dv2plus`, `mx-50`, `c130` (also WebSocket) and `HI6221` (HTTP fetch).
  - All of them share the same IP input handling: trim, strip `http(s)://` / `ws(s)://`, strip `:port` and path.
  - Intentional differences from EK-610i:
    - EK-610i pushes to every qlcl tab; ours pushes to one tab.
    - EK-610i replays the last stable reading on page load and pushes an empty pan (0 g); ours does neither.
    - The callback is `EK610i_onData` there and `HR250A_onData` here.
    - EK-610i has a hard-coded default IP (`172.16.10.84`); ours defaults to empty so setup is forced.
- Git remote: `origin` = company Gitea `http://172.16.10.42:3000/chienlm/HungDuyScaleHR250A.git`, branch `main`.

## Docs
- `NOTES.md` (VN): progress, remaining TODOs, the checklist for testing with the real balance, and the **protocol assumptions not yet verified on real hardware**. Read it first.
- `and_hr250a_rs232_esp32.md` (VN): hardware/user guide covering wiring, the balance function-table settings, flashing, static IP and troubleshooting.
- `chrome-extension/README.md` (VN): installing the extension, the push rules and testing without a balance.
- `tài liệu cân A&D HR-250A.pdf`: the balance manual. RS-232 is on pp. 76–84.
- `docs/huong-dan-setup-cho-IT.md` (VN): factory IT setup guide with no Serial Monitor (scan → use IP / set static IP), plus the box label table (MAC, hostname).
- `docs/superpowers/specs/2026-09-25-network-setup-from-extension-design.md` and `docs/superpowers/plans/2026-09-25-network-setup-from-extension.md`: design and plan for the network-setup feature (firmware 0.4.0 / extension 1.1.0).

## Data flow
```
HR-250A (RS-232C, 2400 7E1) → MAX3232 → UART2 (GPIO5/17)          [or simulator.ino when CMD:SIM:ON]
  → pollBalanceUART() → processBalanceLine() → parseBalanceLine() → readingToJson()
  → USB Serial + WebSocket ws://<eth-ip>:81/
  → chrome-extension (push gate: once per stabilization, never empty pan)
  → window.HR250A_onData(payload) in ONE qlcl tab
```
- The firmware sends `Q` every `poll_ms` (default 500 ms). `POLL:0` turns polling off, for the PRINT key or stream mode.
- The WebSocket JSON keeps the EK-610i gateway fields (`value, unit, stable, unstable, overload, counting, count`), so TI TECH's EK-610i extension also works for a quick test. Keep these fields compatible.

## Build & test
**Firmware.** Use the same board settings as `../HungDuyScale/CLAUDE.md`: esp32 core 3.3.10, board WT32-ETH01, partition No OTA.
- Library: `WebSockets` by Markus Sattler, version 2.7.2 (Library Manager).
- In Arduino IDE, **Erase All Flash must be Disabled**. Otherwise every upload wipes the static IP saved in NVS.
```
arduino-cli compile --fqbn esp32:esp32:wt32-eth01:PartitionScheme=no_ota .
```
**Extension.** Plain ES modules with no build step and no dependencies. Tests run on Node's built-in runner (Node ≥ 22).
```
cd chrome-extension && npm test                  # node --test → test/*.test.js
npm run fake-device -- --port 8181               # tools/fake-device.mjs, fake gateway (no deps)
```
Test files: `lib`, `connection`, `notifier`, `service`, and `e2e-fake-device` (the e2e test runs against the fake device). Shared fakes are in `test/helpers.js`.

## Firmware files
| File | Role |
|------|------|
| `HungDuyScaleHR250A.ino` | globals, `setup()`, `loop()`. Everything runs in `loop()`; the only extra FreeRTOS task is `factoryResetTask` |
| `config.h` | pins, `RESET_HOLD_TIME` 5000, `WS_PORT` 81, `HOSTNAME_PREFIX` `hdscale-hr250a-`, `BAL_LINE_MAX` 64, `PREFS_NAMESPACE` `"balance"`, `BalanceReading`, extern globals, forward decls |
| `and_balance.ino` | UART2 init (7E1/8N1), `sendBalanceCommand()` (routes to the simulator when SIM is on), `processBalanceLine()`, `parseBalanceLine()`, `pollBalanceUART()` |
| `simulator.ino` | simulation mode (see below): `formatAndLine()` builds A&D lines. Not persisted |
| `reading.ino` | `readingToJson()` (adds `"sim":true` while simulating), `errorToJson()` |
| `output.ino` | `outputJson(json, toNetwork)`: always writes to Serial; only readings go to the WebSocket |
| `eth_manager.ino` | Ethernet init (variant PHY pins), DHCP or static IP, hostname `hdscale-hr250a-<last 6 MAC hex>` |
| `ws_server.ino` | WebSocket server, sends the last reading to each new client, routes commands |
| `commands.ino` | `CMD:*` over USB Serial |
| `preferences_mgr.ino` | NVS load/save, `factoryResetTask`, `getInterfaceMacAddress()` (`id` = ETH MAC, uppercase hex, no separators) |

**NVS** (namespace `"balance"`), key and default:
- `bal_baud` 2400
- `bal_7e1` true
- `poll_ms` 500
- `net_static` false
- `net_ip` ""
- `net_gw` ""
- `net_mask` "255.255.255.0"
- `net_dns` ""

**Behaviours worth knowing:**
- UART bytes are masked with `& 0x7F`. A line longer than `BAL_LINE_MAX` (64) is dropped as garbage. USB input lines are capped at 128 chars.
- An `EC,Exx` error line goes to Serial only, **never to the WebSocket**, because the extension would treat any JSON message as a reading. A line that fails to parse is logged as `[RESP]`.
- WebSocket text input is trimmed and dropped if it is empty or longer than 96 chars (`WS_CMD_MAX`).
  - `CMD:SIM:*` goes to the simulator.
  - `CMD:NET:*` goes to network setup (see below).
  - Any other `CMD:*` is rejected; those commands are Serial-only because there is no auth on the LAN.
  - Everything else is forwarded to the balance with CR LF appended.
- If the saved static IP is invalid, the firmware falls back to DHCP. An empty DNS defaults to the gateway.
- To keep the box on a fixed address, the preferred method is a **DHCP reservation** by IT on the ETH MAC (`id`, printed as `ID:` by `CMD:STATUS`). No code is involved. A static IP via `CMD:IP` is the fallback. The procedure and the request template for IT are in `and_hr250a_rs232_esp32.md` §6.2.

## Network setup (`CMD:NET:*`, WebSocket only)
This is what lets factory IT set the box up from the extension, with no Serial access.
- `CMD:NET:INFO` is always answered with `{"type":"net","ok":true,"device","id","ip","mode":"dhcp|static","setupLeftSec","fw"}`.
- `CMD:NET:SET:<ip>,<gw>[,<mask>[,<dns>]]` and `CMD:NET:DHCP` are accepted only while `setupWindowLeftSec() > 0`, i.e. the first `SETUP_WINDOW_MS` (10 min) after power-up.
  - The window is latched closed (`setupClosed` in `ws_server.ino`, refreshed every `loopWebSocket()`), so a `millis()` wrap cannot reopen it.
  - `initSetupWindow()` (called in `setup()`) opens it only when `esp_reset_reason()` is POWERON / EXT (EN button) / BROWNOUT. Any software restart keeps it closed, including the one SET itself triggers, so a LAN client cannot keep it open by re-sending SET.
  - On success the reply is `{"ok":true,"msg":"saved","restartInMs":1500}`. `loop()` then restarts via `restartAt`; there is never a delay inside the WebSocket callback.
- Errors are `{"type":"net","ok":false,"error":"setup-closed"|"bad-args"}`.
- Replies go to the requesting client only (`sendTXT(num, …)`), never broadcast. `type:"reading"` is unchanged.
- `applyStaticIp()` / `applyDhcp()` in `commands.ino` are shared with Serial `CMD:IP` / `CMD:IP:DHCP`.
- `CMD:STATUS` prints `Setup: N s left` / `closed until next power-up`.

## USB Serial (115200)
- Output: lines starting with `{` are data; everything else is log.
- Input: `CMD:...` is a firmware command. Any other line is sent to the balance (or the simulator) with CR LF appended.

Firmware commands. The `CMD:` prefix must be uppercase (`loop()` uses a case-sensitive `startsWith`); the part after it is case-insensitive:
| Command | Effect |
|---|---|
| `CMD:STATUS` | FW, ID, heap, baud/format, poll, raw log, ETH IP, WS clients, SIM state |
| `CMD:POLL:<ms>` | 0 (off) or ≥ 100. Persisted |
| `CMD:BAUD:<n>` | 600/1200/2400/4800/9600/19200. Persisted, re-inits UART2 immediately |
| `CMD:FMT:7E1\|8N1` | Persisted, re-inits UART2 immediately |
| `CMD:RAW:ON\|OFF` | hex dump of received lines (not persisted) |
| `CMD:IP:DHCP` / `CMD:IP:<ip>,<gw>[,<mask>[,<dns>]]` | persisted, **applies only after `CMD:RESTART`** |
| `CMD:RESTART`, `CMD:HELP` | |
| `CMD:SIM:*` | simulator, see below (also accepted over the WebSocket) |

## Simulator (`simulator.ino`)
Replaces the balance at the UART boundary. Generated lines go through `processBalanceLine()` exactly like real data. The simulator is off after every reboot.
- `CMD:SIM:ON` resets tare and turns off overload and auto. `CMD:SIM:OFF` returns to the real balance.
- These commands only work after `SIM:ON`: `PUT:<g>` (0–252 g), `REMOVE` (empties the pan and clears tare), `OL`, `AUTO:ON|OFF`.
- Answers to balance commands:
  - `Q`, `S`, `SI` → the current line.
  - `Z`, `T` → tare.
  - `SIR`, `C` → no-op.
  - Anything else → `EC,E01`, like the real balance.
- Timing:
  - After `PUT`, the reading is unstable for 2 s with ±0.005 g noise, then stable.
  - AUTO loops: a random sample of 1–200 g for 8 s, then an empty pan for 5 s.
  - The overload line is `OL,+9999999E+19`.

**`tools/fake-device.mjs` is NOT identical to the firmware:**
- It starts with SIM already on.
- `PUT` works without `SIM:ON` and has no range check.
- `AUTO:ON` places a sample immediately.
- Unknown commands are ignored instead of answered with `EC,E01`.
- It answers `CMD:NET:*` (flags `--id <MAC>`, `--setup-closed`). It always reports `ip` `127.0.0.1` and `restartInMs` 0, and a SET cannot move it to another IP (`lastNetCommand` records the SET).

Keep these differences in mind when a test passes on the fake but fails on the device.

## Extension (`chrome-extension/`)
MV3, minimum Chrome 116.
- Permissions: `storage`, `alarms`, `scripting`.
- Host permissions: `qlcl.hungduy.vn`, `localhost`, `127.0.0.1` (http and https).

Layout:
- `src/lib/`: pure logic, with **no `chrome.*` or WebSocket**.
  - `config.js`: `DEFAULTS` and `normalizeConfig()`, the single source of truth for settings.
  - `reading.js`: `parseDeviceMessage()` (readings carry `id`/`device`), `parseNetMessage()`, `toWebPayload()`.
  - `net-config.js`: `validateStaticNet()`, which blocks a bad IP/gateway/mask, a gateway in another subnet, or a network/broadcast address before anything is sent. Also `netSetCommand()`, `formatMac()`, `NET_*_COMMAND`.
  - `scan.js`: `normalizePrefix()`, `prefixOf()`, `hostsIn()` (.1–.254), `runPool()`.
  - `push-gate.js`, `tab-picker.js`.
  - `backoff.js`: 1 s, doubling, capped at 30 s.
  - `history.js`: 20 entries, newest first.
  - `messages.js`: statuses and failure reasons.
- `src/background/`:
  - `connection.js`: WebSocket, backoff, `probeDevice()` for "test connection", and `netRequest()`, a one-shot `CMD:NET:*` exchange. `netRequest()` skips readings until the net reply arrives; a box that only sends readings is reported as legacy.
  - `notifier.js`: runs `executeScript` in the MAIN world of one tab.
  - `service.js`: all wiring. Chrome APIs are injected, so it is tested in Node.
  - `main.js`: only binds Chrome APIs and sets a 1-minute keepalive alarm that calls `connection.ensure()`.
- `src/popup/`: live weight, status, SIM badge, Zero/Tare, Resend, Connect, history.
- `src/options/`: the "Cài đặt hộp cân lần đầu" card (Tìm hộp cân / Dùng IP này / Đặt IP cố định…), the settings form, and a "Chạy thử" panel that sends `CMD:SIM:*`, `Z` and `T`.
- `src/ui.css`: styles shared by popup and options.
- `web-snippet/HR250A_onData.js`: a reference copy of the web callback. The real one lives in `QuanLyChatLuong/Views/Shared/_Layout.cshtml`. It has an open TODO about the weight field id regex (`cboWeight\d*`).

Settings are stored in `chrome.storage.local`. Keys and defaults:
- `deviceIp` `""`: IPv4 or hostname; a `ws://` or `http://` prefix is stripped.
- `wsPort` 81
- `autoConnect` true
- `minWeight` 0.001 g
- `connectTimeoutSec` 5 (clamped to 2–30)
- `allowLocalhost` false

`history` is also kept in `local`. Live state is written to `chrome.storage.session` under `live` (`status, error, deviceIp, lastReading, badMessages, updatedAt`), at most once every 300 ms.

- **Runtime messages** (`service.js`): `getState`, `connect`, `disconnect`, `applySettings`, `sendCommand {cmd}`, `resend`, `testConnection {deviceIp, wsPort, connectTimeoutSec}`.
- **`testConnection {save: true, ...wholeForm}`** is what Options' "Kiểm tra & lưu" sends. It validates the whole form, stores it **only if the probe gets a reading**, then reconnects. Without `save` it only probes.
- **Network setup actions:**
  - `scanNetwork {prefix, wsPort}`: 32 in parallel, 1.5 s per host, progress in `live.scan`. It returns `devices[{ip, wsPort, id, mode, setupLeftSec, fw, legacy, canSetup}]`.
  - `useDevice {ip, wsPort}`: saves the IP after the box answers `CMD:NET:INFO`.
  - `setDeviceNetwork {mode, currentIp, wsPort, id, ip, gw, mask, dns}`: validates, sends SET/DHCP, and waits for `restartInMs`. It then re-finds **the same MAC** at the new IP (every 2 s, up to 40 s) and only then saves `deviceIp`. In DHCP mode it returns `{dhcp:true}` and the user rescans.
- **Command whitelist:** `sendCommand` only accepts `/^(Z|T|CMD:SIM:[A-Z0-9.:+-]{1,24})$/`. The extension never sends `Q`.
- **Statuses:** connecting / connected / reconnecting / disconnected.
- **Delivery failures:** `no-tab`, `no-handler`, `handler-error`, `inject-failed`.
- **Target tab:** exactly one tab gets each reading. The picker tries, in order: the active target tab in the focused window, then any active target tab, then the target tab with the highest `lastAccessed`.

### Push gate (`push-gate.js`, evaluated in this order)
1. `OVERLOAD`: re-arm, skip. The last pushed value is kept.
2. `COUNT`, or a unit other than `g`: skip, no state change.
3. `value <= minWeight` (empty pan, or negative after tare): re-arm, clear the last pushed value, skip. This check runs **before** the unstable check.
4. `UNSTABLE`: re-arm, skip.
5. `STABLE`: push only if armed **and** `valueText` differs from the last push. Pushing disarms the gate.

Nothing is replayed on page load. Resend (popup) pushes `lastReading` manually with `source: "resend"`.

### Web callback contract
```js
window.HR250A_onData({ device: "HR250A", value, valueText, unit, stable,
  Status: "STABLE|UNSTABLE|OVERLOAD|COUNT", Date: "YYYY-MM-DD", Time: "HH:mm:ss", sim })
```
- `valueText` keeps the balance's own decimals (taken from the JSON `weight` field).
- Date and Time are stamped by the extension; the device has no clock.
- The shape matches the EK-610i reading (`value/unit/stable/Status/Date/Time`), plus `valueText` and `sim`.

## Balance protocol (A&D standard format)
- Line format: `ST,+00012.3456  g\r\n`. Headers: `ST` stable, `US` unstable, `OL` overload, `QT` counting.
- Commands to the balance end with CR LF: `Q` read now, `S` read when stable, `SIR` stream, `C` stop, `Z` zero, `T` tare, `?ID` `?SN` `?TN`.
- `EC,Exx` is an error; `0x06` is AK.
- Some format details are still unverified on the real balance; see `NOTES.md`.

WebSocket / Serial JSON (`sim` is present only in simulation mode):
```json
{"type":"reading","device":"HR250A","id":"<ETH MAC>","header":"ST","stable":true,"unstable":false,"overload":false,"counting":false,"count":null,"value":12.3456,"unit":"g","weight":"12.3456 g","raw":"ST,+00012.3456  g","uptime":12345,"sim":true}
```

## Pins & known issues
- Balance UART: RX = GPIO5 (← MAX3232 TXD), TX = GPIO17 (→ MAX3232 RXD). **Not GPIO16**, which is `ETH_PHY_POWER` on the WT32-ETH01.
- **Factory reset is suspect.**
  - What it should do: `factoryResetTask` reads `LED_PIN` (GPIO2) and clears the `"balance"` NVS namespace when the pin is held LOW for more than 5 s.
  - The problem: `setup()` also drives GPIO2 as an OUTPUT set HIGH for the LED. A button to GND would short a pin being driven HIGH, so the reset may never trigger.
  - The task is also created before `pinMode()` runs.
  - Not fixed yet. There is no LED status blinking; the LED just stays on.
