#pragma once

#include <Arduino.h>
#include <Preferences.h>
#include <ETH.h>
#include <WebSocketsServer.h>   // library "WebSockets" by Markus Sattler
#include "esp_mac.h"
#include "esp_system.h"         // esp_reset_reason()

// ============== Timing ==============
#define RESET_HOLD_TIME    5000

// ============== Pin Definitions ==============
// WT32-ETH01: GPIO16 is the Ethernet PHY power pin (ETH_PHY_POWER) — do not use it for UART.
#define LED_PIN            2
#define BAL_RX_PIN         5     // ← TXD (TTL) of MAX3232 module
#define BAL_TX_PIN         17    // → RXD (TTL) of MAX3232 module

// ============== Balance ==============
#define BAL_DEVICE_NAME    "HR250A"
#define BAL_LINE_MAX       64
#define PREFS_NAMESPACE    "balance"

// ============== Network ==============
// Same contract as the EK-610i gateway: Chrome extension connects to ws://<ip>:81/
#define WS_PORT            81
#define HOSTNAME_PREFIX    "hdscale-hr250a-"

// ============== Network setup over WebSocket (CMD:NET:*) ==============
// SET/DHCP are accepted only during the first SETUP_WINDOW_MS after a real power-up, so
// changing the address needs physical access (power-cycle the box). A software restart
// (including the one SET triggers) keeps the window closed. INFO is always answered.
#define SETUP_WINDOW_MS       600000UL
#define NET_RESTART_DELAY_MS  1500UL    // reply first, restart from loop() afterwards
#define WS_CMD_MAX            96        // longest accepted WebSocket text command

// One parsed line of A&D standard format, e.g. "ST,+00012.3456  g"
struct BalanceReading {
  String header;      // ST / US / OL / QT
  bool   stable   = false;
  bool   overload = false;
  bool   counting = false;
  bool   hasValue = false;
  double value    = 0.0;
  int    decimals = 0;
  String unit;        // g, mg, PC, % ...
  String raw;
};

// ============== Forward Declarations ==============
void    loadSettings();
void    saveSettings();
void    initBalanceUART();
void    sendBalanceCommand(const String &cmd, bool log);
void    pollBalanceUART();
void    processBalanceLine(const String &line);
bool    parseBalanceLine(const String &line, BalanceReading &r);
String  formatAndLine(const char *header, double value, const char *unit);
void    simHandleBalanceCommand(const String &cmd);
bool    handleSimCommand(const String &sub);
void    simLoop();
String  simStatusText();
String  readingToJson(const BalanceReading &r);
String  errorToJson(const String &code, const String &raw);
void    outputJson(const String &json, bool toNetwork);
void    initEthernet();
void    initWebSocket();
void    loopWebSocket();
void    wsBroadcast(const String &json);
int     wsClientCount();
void    handleSerialCommand(String cmd);
String  getInterfaceMacAddress(esp_mac_type_t interface);
void    factoryResetTask(void *parameter);
bool    applyStaticIp(const String &args);
void    applyDhcp();
unsigned long setupWindowLeftSec();
void    initSetupWindow();

// ============== Extern Globals ==============
extern String firmwareVer;
extern String macAddress;

extern unsigned long balBaudRate;
extern bool          balUse7E1;
extern unsigned long balPollMs;
extern bool          balRawLog;
extern bool          simEnabled;

extern bool   netStaticIP;
extern String netIP;
extern String netGateway;
extern String netSubnet;
extern String netDNS;
extern bool   ethGotIP;
extern unsigned long restartAt;

extern Preferences preferences;
