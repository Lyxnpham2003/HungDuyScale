#include "config.h"

// ============== Globals ==============
String firmwareVer = "0.4.0";
String macAddress  = "";

unsigned long balBaudRate = 2400;   // A&D default
bool          balUse7E1   = true;   // A&D default: 7 bits, even parity, 1 stop
unsigned long balPollMs   = 500;    // send "Q" every N ms; 0 = off (PRINT key / stream mode)
bool          balRawLog   = false;  // hex dump of every received line (not persisted)

bool   netStaticIP = false;         // false = DHCP
String netIP       = "";
String netGateway  = "";
String netSubnet   = "255.255.255.0";
String netDNS      = "";
bool   ethGotIP    = false;
unsigned long restartAt = 0;   // millis() at which loop() restarts the ESP (0 = none)

Preferences preferences;

static String        usbLine  = "";
static unsigned long lastPoll = 0;

// ============== Setup ==============
void setup() {
  xTaskCreatePinnedToCore(factoryResetTask, "factoryResetTask", 2048, NULL, 1, NULL, 0);
  Serial.begin(115200);
  macAddress = getInterfaceMacAddress(ESP_MAC_ETH);
  Serial.println("\n=== HungDuyScaleHR250A v" + firmwareVer + " ===");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  loadSettings();
  initBalanceUART();
  initEthernet();
  initSetupWindow();
  initWebSocket();

  Serial.println("Ready. Type CMD:HELP, or a balance command (Q, Z, T, SIR, C...)");
}

// ============== Loop ==============
// Everything runs in loop() (no extra tasks) so UART, WebSocket and Serial
// never touch shared state concurrently.
void loop() {
  // Deferred restart after CMD:NET:SET/DHCP, so the WebSocket reply is sent first
  if (restartAt != 0 && (long)(millis() - restartAt) >= 0) {
    Serial.println("Restarting to apply network settings...");
    delay(100);
    ESP.restart();
  }

  // USB serial input: "CMD:..." = firmware command, anything else = forwarded to balance
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r' || c == '\n') {
      usbLine.trim();
      if (usbLine.length() > 0) {
        if (usbLine.startsWith("CMD:")) handleSerialCommand(usbLine.substring(4));
        else                            sendBalanceCommand(usbLine, true);
      }
      usbLine = "";
    } else if (usbLine.length() < 128) {
      usbLine += c;
    }
  }

  if (balPollMs > 0 && millis() - lastPoll >= balPollMs) {
    lastPoll = millis();
    sendBalanceCommand("Q", false);
  }

  pollBalanceUART();
  simLoop();
  loopWebSocket();

  delay(1);
}
