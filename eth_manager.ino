// ============== Ethernet (WT32-ETH01, LAN8720) ==============
// PHY pins come from the board variant (ETH_PHY_* in pins_arduino.h).

static void onNetworkEvent(arduino_event_id_t event) {
  switch (event) {
    case ARDUINO_EVENT_ETH_START:
      ETH.setHostname((HOSTNAME_PREFIX + macAddress.substring(6)).c_str());
      break;
    case ARDUINO_EVENT_ETH_CONNECTED:
      Serial.println("ETH link up");
      break;
    case ARDUINO_EVENT_ETH_GOT_IP:
      ethGotIP = true;
      Serial.println("ETH IP: " + ETH.localIP().toString() +
                     (netStaticIP ? " (static)" : " (DHCP)") +
                     " → ws://" + ETH.localIP().toString() + ":" + String(WS_PORT) + "/");
      break;
    case ARDUINO_EVENT_ETH_LOST_IP:
    case ARDUINO_EVENT_ETH_DISCONNECTED:
    case ARDUINO_EVENT_ETH_STOP:
      if (ethGotIP) Serial.println("ETH disconnected");
      ethGotIP = false;
      break;
    default:
      break;
  }
}

void initEthernet() {
  Network.onEvent(onNetworkEvent);
  if (!ETH.begin()) {
    Serial.println("ETH init failed");
    return;
  }
  if (netStaticIP) {
    IPAddress ip, gw, mask, dns;
    if (ip.fromString(netIP) && gw.fromString(netGateway) && mask.fromString(netSubnet)) {
      if (!dns.fromString(netDNS)) dns = gw;
      ETH.config(ip, gw, mask, dns);
    } else {
      Serial.println("ETH static IP invalid, falling back to DHCP");
    }
  }
  Serial.println("ETH initialized (" + String(netStaticIP ? "static " + netIP : "DHCP") + ")");
}
