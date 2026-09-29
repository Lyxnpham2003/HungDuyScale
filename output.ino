// ============== Output ==============
// USB Serial convention: a line starting with '{' is data, anything else is a log.

void outputJson(const String &json, bool toNetwork) {
  Serial.println(json);
  if (toNetwork) wsBroadcast(json);
}
