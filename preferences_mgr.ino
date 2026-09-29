// ============== Preferences (NVS) ==============

String getInterfaceMacAddress(esp_mac_type_t interface) {
  String mac = "";
  unsigned char mac_base[6] = {0};
  if (esp_read_mac(mac_base, interface) == ESP_OK) {
    char buffer[13];
    sprintf(buffer, "%02X%02X%02X%02X%02X%02X",
            mac_base[0], mac_base[1], mac_base[2],
            mac_base[3], mac_base[4], mac_base[5]);
    mac = buffer;
  }
  return mac;
}

void factoryResetTask(void *parameter) {
  unsigned long buttonPressTime = 0;
  bool resetTriggered = false;
  while (true) {
    if (digitalRead(LED_PIN) == LOW) {
      if (buttonPressTime == 0) buttonPressTime = millis();
      if (!resetTriggered && (millis() - buttonPressTime > RESET_HOLD_TIME)) {
        Serial.println("Factory reset triggered!");
        preferences.begin(PREFS_NAMESPACE, false);
        preferences.clear();
        preferences.end();
        resetTriggered = true;
        delay(1000);
        ESP.restart();
      }
    } else {
      buttonPressTime = 0;
    }
    delay(500);
  }
}

void loadSettings() {
  preferences.begin(PREFS_NAMESPACE, true);

  balBaudRate = preferences.getULong("bal_baud", 2400);
  balUse7E1   = preferences.getBool("bal_7e1", true);
  balPollMs   = preferences.getULong("poll_ms", 500);

  netStaticIP = preferences.getBool("net_static", false);
  netIP       = preferences.getString("net_ip", "");
  netGateway  = preferences.getString("net_gw", "");
  netSubnet   = preferences.getString("net_mask", "255.255.255.0");
  netDNS      = preferences.getString("net_dns", "");

  preferences.end();

  Serial.println("Settings loaded");
  Serial.println("  Balance baud: "   + String(balBaudRate));
  Serial.println("  Balance format: " + String(balUse7E1 ? "7E1" : "8N1"));
  Serial.println("  Poll (Q): "       + (balPollMs > 0 ? String(balPollMs) + " ms" : String("Off")));
  Serial.println("  Network: "        + (netStaticIP ? "static " + netIP + " gw " + netGateway + " mask " + netSubnet
                                                     : String("DHCP")));
}

void saveSettings() {
  preferences.begin(PREFS_NAMESPACE, false);

  preferences.putULong("bal_baud", balBaudRate);
  preferences.putBool("bal_7e1",   balUse7E1);
  preferences.putULong("poll_ms",  balPollMs);

  preferences.putBool("net_static",  netStaticIP);
  preferences.putString("net_ip",    netIP);
  preferences.putString("net_gw",    netGateway);
  preferences.putString("net_mask",  netSubnet);
  preferences.putString("net_dns",   netDNS);

  preferences.end();
  Serial.println("Settings saved");
}
