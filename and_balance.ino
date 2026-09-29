// ============== A&D Balance (RS-232C, A&D standard format) ==============

void initBalanceUART() {
  Serial2.end();
  Serial2.begin(balBaudRate, balUse7E1 ? SERIAL_7E1 : SERIAL_8N1, BAL_RX_PIN, BAL_TX_PIN);
  Serial.println("UART2 initialized (RX:" + String(BAL_RX_PIN) +
                 " TX:" + String(BAL_TX_PIN) +
                 " Baud:" + String(balBaudRate) +
                 " Format:" + String(balUse7E1 ? "7E1" : "8N1") + ")");
}

// Commands are terminated with CR LF (balance setting "Crlf" = 0)
void sendBalanceCommand(const String &cmd, bool log) {
  if (log) Serial.println(String(simEnabled ? "[TX-SIM] " : "[TX] ") + cmd);
  if (simEnabled) {
    simHandleBalanceCommand(cmd);
    return;
  }
  Serial2.print(cmd);
  Serial2.print("\r\n");
}

// "ST,+00012.3456  g" → header ST, value 12.3456 (4 decimals), unit g
bool parseBalanceLine(const String &line, BalanceReading &r) {
  r = BalanceReading();
  r.raw = line;
  if (line.length() < 4 || line[2] != ',') return false;

  r.header = line.substring(0, 2);
  if (r.header != "ST" && r.header != "US" && r.header != "OL" && r.header != "QT") return false;
  r.stable   = (r.header == "ST");
  r.overload = (r.header == "OL");
  r.counting = (r.header == "QT");
  if (r.overload) return true;  // overload data (e.g. "+9999999E+19") is not a weight

  String body = line.substring(3);
  body.trim();
  int end = 0;
  if (end < (int)body.length() && (body[end] == '+' || body[end] == '-')) end++;
  int digitsStart = end;
  int dot = -1;
  while (end < (int)body.length() && (isDigit(body[end]) || body[end] == '.')) {
    if (body[end] == '.') dot = end;
    end++;
  }
  if (end == digitsStart) return false;

  r.hasValue = true;
  r.value    = body.substring(0, end).toDouble();
  r.decimals = (dot >= 0) ? end - dot - 1 : 0;
  r.unit     = body.substring(end);
  r.unit.trim();
  return true;
}

// Real UART lines and simulated lines (simulator.ino) both enter here
void processBalanceLine(const String &line) {
  if (balRawLog) {
    String hexDump = "[LINE_HEX]";
    for (int i = 0; i < (int)line.length(); i++) {
      char h[4];
      sprintf(h, " %02X", (uint8_t)line[i]);
      hexDump += h;
    }
    Serial.println(hexDump);
  }

  if (line == "\x06") {                 // <AK> acknowledge (setting "erCd" = 1)
    Serial.println("[AK]");
    return;
  }
  if (line.startsWith("EC,")) {         // e.g. "EC,E02" not ready
    // Serial only — the extension would treat any JSON message as a reading
    outputJson(errorToJson(line.substring(3), line), false);
    return;
  }

  BalanceReading r;
  if (parseBalanceLine(line, r)) {
    outputJson(readingToJson(r), true);
  } else {
    Serial.println("[RESP] " + line);   // ?ID, ?SN, PT,... or garbage
  }
}

// Called from loop(): drains UART2 and processes complete lines
void pollBalanceUART() {
  static String buf = "";
  if (simEnabled) {                       // ignore the real balance while simulating
    while (Serial2.available()) Serial2.read();
    buf = "";
    return;
  }
  while (Serial2.available()) {
    char c = Serial2.read() & 0x7F;
    if (c == '\n') {
      buf.trim();
      if (buf.length() > 0) processBalanceLine(buf);
      buf = "";
    } else if (c != '\r') {
      buf += c;
      if (buf.length() > BAL_LINE_MAX) buf = "";  // garbage (wrong baud/parity)
    }
  }
}
