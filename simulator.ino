// ============== Simulation mode ==============
// Replaces the balance at the UART boundary: commands that would go to the
// balance are answered here with standard A&D lines, which then go through
// processBalanceLine() exactly like real data (parse → JSON → WebSocket).
// Not persisted — every boot starts in real-balance mode.

#define SIM_SETTLE_MS       2000
#define SIM_AUTO_LOADED_MS  8000
#define SIM_AUTO_EMPTY_MS   5000

bool                 simEnabled     = false;
static double        simTarget      = 0.0;   // gross mass on the pan (g)
static double        simTare        = 0.0;
static unsigned long simSettleUntil = 0;
static bool          simOverload    = false;
static bool          simAuto        = false;
static bool          simAutoLoaded  = false;
static unsigned long simAutoNext    = 0;

// A&D standard format: "ST,+00012.3456  g" (sign + 10 chars, unit right-aligned in 3)
String formatAndLine(const char *header, double value, const char *unit) {
  char num[16];
  snprintf(num, sizeof(num), "%010.4f", fabs(value));
  char line[40];
  snprintf(line, sizeof(line), "%s,%c%s%3s", header, value < 0 ? '-' : '+', num, unit);
  return String(line);
}

static String simCurrentLine() {
  if (simOverload) return "OL,+9999999E+19";
  double shown = simTarget - simTare;
  if (millis() < simSettleUntil) {
    double noise = random(-50, 51) / 10000.0;   // ±0.005 g while settling
    return formatAndLine("US", shown + noise, "g");
  }
  return formatAndLine("ST", shown, "g");
}

static void simPut(double grams) {
  simOverload    = false;
  simTarget      = simTare + grams;
  simSettleUntil = millis() + SIM_SETTLE_MS;
}

static void simRemove() {
  simOverload    = false;
  simTarget      = 0.0;
  simTare        = 0.0;
  simSettleUntil = millis() + SIM_SETTLE_MS;
}

static double simRandomSample() {
  return random(10000, 2000001) / 10000.0;      // 1.0000 – 200.0000 g
}

// Called by sendBalanceCommand() instead of writing to UART2
void simHandleBalanceCommand(const String &cmd) {
  String c = cmd;
  c.toUpperCase();
  if (c == "Q" || c == "S" || c == "SI") {
    processBalanceLine(simCurrentLine());
  } else if (c == "Z" || c == "T") {
    simTare     = simTarget;
    simOverload = false;
  } else if (c == "SIR" || c == "C") {
    // stream mode not simulated — polling (CMD:POLL) drives the readings
  } else {
    processBalanceLine("EC,E01");               // undefined command, like the real balance
  }
}

// Called from loop(): drives CMD:SIM:AUTO
void simLoop() {
  if (!simEnabled || !simAuto || millis() < simAutoNext) return;
  if (simAutoLoaded) {
    simRemove();
    simAutoNext = millis() + SIM_AUTO_EMPTY_MS;
  } else {
    simPut(simRandomSample());
    simAutoNext = millis() + SIM_AUTO_LOADED_MS;
  }
  simAutoLoaded = !simAutoLoaded;
}

// "ON", "OFF", "PUT:<g>", "REMOVE", "OL", "AUTO:ON", "AUTO:OFF"
bool handleSimCommand(const String &sub) {
  String s = sub;
  s.toUpperCase();

  if (s == "ON") {
    simEnabled = true;
    simTarget = simTare = 0.0;
    simOverload = simAuto = false;
    Serial.println("OK: SIM on — balance UART is bypassed. Readings carry \"sim\":true");
  } else if (s == "OFF") {
    simEnabled = false;
    simAuto = false;
    Serial.println("OK: SIM off — back to the real balance");
  } else if (!simEnabled) {
    Serial.println("ERR: SIM is off. Send CMD:SIM:ON first");
    return false;
  } else if (s.startsWith("PUT:")) {
    double g = s.substring(4).toDouble();
    if (g < 0 || g > 252) {
      Serial.println("ERR: PUT must be 0–252 g");
      return false;
    }
    simPut(g);
    Serial.println("OK: SIM put " + String(g, 4) + " g");
  } else if (s == "REMOVE") {
    simRemove();
    Serial.println("OK: SIM pan emptied");
  } else if (s == "OL") {
    simOverload = true;
    Serial.println("OK: SIM overload");
  } else if (s == "AUTO:ON") {
    simAuto = true;
    simAutoLoaded = false;
    simAutoNext = 0;
    Serial.println("OK: SIM auto scenario on");
  } else if (s == "AUTO:OFF") {
    simAuto = false;
    Serial.println("OK: SIM auto scenario off");
  } else {
    Serial.println("ERR: Unknown SIM command. Send CMD:HELP");
    return false;
  }
  return true;
}

String simStatusText() {
  if (!simEnabled) return "Off";
  if (simOverload) return "On (overload)";
  return "On, shown " + String(simTarget - simTare, 4) + " g" + (simAuto ? ", auto" : "");
}
