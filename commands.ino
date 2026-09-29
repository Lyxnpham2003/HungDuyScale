// ============== USB Serial Command Handler ==============

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

void handleSerialCommand(String cmd) {
  String cmdUpper = cmd;
  cmdUpper.toUpperCase();

  if (cmdUpper == "STATUS") {
    Serial.println("FW: "      + firmwareVer);
    Serial.println("ID: "      + macAddress);
    Serial.println("Heap: "    + String(ESP.getFreeHeap()));
    Serial.println("Baud: "    + String(balBaudRate));
    Serial.println("Format: "  + String(balUse7E1 ? "7E1" : "8N1"));
    Serial.println("Poll: "    + (balPollMs > 0 ? String(balPollMs) + " ms" : String("Off")));
    Serial.println("RawLog: "  + String(balRawLog ? "On" : "Off"));
    Serial.println("ETH: "     + (ethGotIP ? ETH.localIP().toString() : String("no IP")) +
                   (netStaticIP ? " (static)" : " (DHCP)"));
    Serial.println("WS: port " + String(WS_PORT) + ", " + String(wsClientCount()) + " client(s)");
    Serial.println("SIM: "     + simStatusText());
    Serial.println("Setup: "   + (setupWindowLeftSec() > 0 ? String(setupWindowLeftSec()) + " s left (CMD:NET:SET open)"
                                                           : String("closed until next power-up")));

  } else if (cmdUpper.startsWith("SIM:")) {
    handleSimCommand(cmd.substring(4));

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

  } else if (cmdUpper.startsWith("POLL:")) {
    long ms = cmd.substring(5).toInt();
    if (ms == 0 || ms >= 100) {
      balPollMs = ms;
      saveSettings();
      Serial.println("OK: Poll=" + (balPollMs > 0 ? String(balPollMs) + " ms" : String("Off")));
    } else {
      Serial.println("ERR: Poll must be 0 (off) or >= 100 ms");
    }

  } else if (cmdUpper.startsWith("BAUD:")) {
    long baud = cmd.substring(5).toInt();
    if (baud == 600 || baud == 1200 || baud == 2400 || baud == 4800 || baud == 9600 || baud == 19200) {
      balBaudRate = baud;
      saveSettings();
      initBalanceUART();
      Serial.println("OK: Baud=" + String(balBaudRate));
    } else {
      Serial.println("ERR: Baud must be 600/1200/2400/4800/9600/19200");
    }

  } else if (cmdUpper == "FMT:7E1" || cmdUpper == "FMT:8N1") {
    balUse7E1 = (cmdUpper == "FMT:7E1");
    saveSettings();
    initBalanceUART();
    Serial.println("OK: Format=" + String(balUse7E1 ? "7E1" : "8N1"));

  } else if (cmdUpper == "RAW:ON" || cmdUpper == "RAW:OFF") {
    balRawLog = (cmdUpper == "RAW:ON");
    Serial.println("OK: RawLog=" + String(balRawLog ? "On" : "Off"));

  } else if (cmdUpper == "RESTART") {
    Serial.println("OK: Restarting...");
    delay(200);
    ESP.restart();

  } else if (cmdUpper == "HELP") {
    Serial.println("Firmware commands:");
    Serial.println("  CMD:STATUS");
    Serial.println("  CMD:POLL:<ms>      send Q every <ms> (0 = off, for PRINT key / stream mode)");
    Serial.println("  CMD:BAUD:<n>       600/1200/2400/4800/9600/19200");
    Serial.println("  CMD:FMT:7E1|8N1");
    Serial.println("  CMD:RAW:ON|OFF     hex dump of received lines");
    Serial.println("  CMD:IP:DHCP");
    Serial.println("  CMD:IP:<ip>,<gateway>[,<subnet>[,<dns>]]   static IP (apply with CMD:RESTART)");
    Serial.println("Simulation (test without a balance; also accepted over WebSocket; off after reboot):");
    Serial.println("  CMD:SIM:ON|OFF");
    Serial.println("  CMD:SIM:PUT:<g>    place a sample (unstable ~2 s, then stable)");
    Serial.println("  CMD:SIM:REMOVE     empty the pan");
    Serial.println("  CMD:SIM:OL         overload");
    Serial.println("  CMD:SIM:AUTO:ON|OFF  loop: random sample 8 s, empty 5 s");
    Serial.println("Network setup over WebSocket (used by the extension):");
    Serial.println("  CMD:NET:INFO       MAC, IP, DHCP/static, seconds left in the setup window");
    Serial.println("  CMD:NET:SET:<ip>,<gw>[,<mask>[,<dns>]]  |  CMD:NET:DHCP");
    Serial.println("                     only in the first 10 min after power-up; saves and restarts");
    Serial.println("  CMD:RESTART");
    Serial.println("Anything else is sent to the balance + CR LF, e.g.:");
    Serial.println("  Q (read now)  S (read when stable)  SIR (stream)  C (stop stream)");
    Serial.println("  Z (re-zero)   T (tare)              ?ID  ?SN  ?TN");

  } else {
    Serial.println("ERR: Unknown command. Send CMD:HELP");
  }
}
