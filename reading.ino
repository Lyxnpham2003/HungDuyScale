// ============== Reading → JSON ==============
// One JSON object per line. Web side receives it as window.HR250A_onData(obj).

static String jsonEscape(const String &s) {
  String out = "";
  for (int i = 0; i < (int)s.length(); i++) {
    char c = s[i];
    if      (c == '"')  out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if ((uint8_t)c < 0x20) {
      char h[7];
      sprintf(h, "\\u%04X", (uint8_t)c);
      out += h;
    }
    else out += c;
  }
  return out;
}

String readingToJson(const BalanceReading &r) {
  String valueStr = r.hasValue ? String(r.value, (unsigned int)r.decimals) : "";

  // Fields value/unit/stable/unstable/overload/counting/count match what the
  // EK-610i extension reads (readingFromMsg); the rest is extra info.
  String j = "{\"type\":\"reading\"";
  j += ",\"device\":\"" BAL_DEVICE_NAME "\"";
  j += ",\"id\":\"" + macAddress + "\"";
  j += ",\"header\":\"" + r.header + "\"";
  j += ",\"stable\":" + String(r.stable ? "true" : "false");
  j += ",\"unstable\":" + String(r.header == "US" ? "true" : "false");
  j += ",\"overload\":" + String(r.overload ? "true" : "false");
  j += ",\"counting\":" + String(r.counting ? "true" : "false");
  j += ",\"count\":" + ((r.counting && r.hasValue) ? String((long)r.value) : String("null"));
  j += ",\"value\":" + (r.hasValue ? valueStr : String("null"));
  j += ",\"unit\":\"" + jsonEscape(r.unit) + "\"";
  j += ",\"weight\":\"" + (r.hasValue ? jsonEscape(valueStr + " " + r.unit) : String("")) + "\"";
  j += ",\"raw\":\"" + jsonEscape(r.raw) + "\"";
  j += ",\"uptime\":" + String(millis());
  if (simEnabled) j += ",\"sim\":true";
  j += "}";
  return j;
}

String errorToJson(const String &code, const String &raw) {
  String j = "{\"type\":\"error\"";
  j += ",\"device\":\"" BAL_DEVICE_NAME "\"";
  j += ",\"id\":\"" + macAddress + "\"";
  j += ",\"code\":\"" + jsonEscape(code) + "\"";
  j += ",\"raw\":\"" + jsonEscape(raw) + "\"";
  j += ",\"uptime\":" + String(millis());
  j += "}";
  return j;
}
