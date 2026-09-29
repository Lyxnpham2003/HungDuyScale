// ============== WebSocket Server (port 81) ==============
// Device → extension: one JSON reading per message (see readingToJson()).
// Extension → device: text is forwarded to the balance as a command (e.g. "Q", "Z", "T"),
// except "CMD:SIM:*" (simulator) and "CMD:NET:*" (network setup). Other CMD:* are Serial-only (no auth on LAN).

static WebSocketsServer webSocket(WS_PORT);
static int              wsClients = 0;
static String           lastReadingJson = "";
static bool             setupClosed = false;   // latched so a millis() wrap (~49.7 days) never reopens the window

// Called once from setup(). Only a power-on, the EN/reset button or a brownout (all
// physical) open the window; ESP.restart(), panics and watchdog resets keep it closed,
// otherwise a LAN client could keep re-opening it by sending CMD:NET:SET every few minutes.
void initSetupWindow() {
  esp_reset_reason_t r = esp_reset_reason();
  if (r != ESP_RST_POWERON && r != ESP_RST_EXT && r != ESP_RST_BROWNOUT) setupClosed = true;
  Serial.println(setupClosed ? "Setup window: closed (not a power-up; unplug/replug power to open it)"
                             : "Setup window: open for 10 min (CMD:NET:SET over WebSocket)");
}

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

static void onWsEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      wsClients++;
      Serial.printf("WS client #%u connected from %s (%d total)\n",
                    num, webSocket.remoteIP(num).toString().c_str(), wsClients);
      if (lastReadingJson.length() > 0) webSocket.sendTXT(num, lastReadingJson);
      break;
    case WStype_DISCONNECTED:
      if (wsClients > 0) wsClients--;
      Serial.printf("WS client #%u disconnected (%d total)\n", num, wsClients);
      break;
    case WStype_TEXT: {
      String cmd = String((const char *)payload, length);
      cmd.trim();
      if (cmd.length() == 0 || cmd.length() > WS_CMD_MAX) break;
      String upper = cmd;
      upper.toUpperCase();
      if (upper.startsWith("CMD:SIM:")) {
        Serial.println("[WS] " + cmd);
        handleSimCommand(cmd.substring(8));
      } else if (upper.startsWith("CMD:NET:")) {
        handleNetCommand(num, cmd.substring(8));
      } else if (upper.startsWith("CMD:")) {
        Serial.println("[WS] rejected (Serial only): " + cmd);
      } else {
        sendBalanceCommand(cmd, true);
      }
      break;
    }
    default:
      break;
  }
}

void initWebSocket() {
  webSocket.begin();
  webSocket.onEvent(onWsEvent);
  Serial.println("WebSocket server on port " + String(WS_PORT));
}

void loopWebSocket() {
  setupWindowLeftSec();   // keep the setup-window latch current
  webSocket.loop();
}

void wsBroadcast(const String &json) {
  lastReadingJson = json;
  if (wsClients > 0) webSocket.broadcastTXT(json.c_str(), json.length());
}

int wsClientCount() {
  return wsClients;
}
