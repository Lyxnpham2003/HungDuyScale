// Parses one WebSocket message from the HungDuyScaleHR250A firmware (readingToJson()).

export const DEVICE_NAME = "HR250A";

const pad = (n) => String(n).padStart(2, "0");

function stamp(date) {
  return {
    Date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    Time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
}

// "12.3400 g" → "12.3400" (keeps the balance's decimals, unlike Number → String)
function textFromWeight(weight) {
  if (typeof weight !== "string") return null;
  const m = weight.trim().match(/^-?\d+(\.\d+)?/);
  return m ? m[0] : null;
}

// Returns a normalized reading, or null if the message is not a valid reading.
export function parseDeviceMessage(text, now = new Date()) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || d.type !== "reading") return null;

  const overload = d.overload === true || d.header === "OL";
  let value = null;
  if (!overload) {
    if (typeof d.value !== "number" || !Number.isFinite(d.value)) return null;
    value = d.value;
  }

  let status;
  if (overload) status = "OVERLOAD";
  else if (d.counting === true || d.header === "QT") status = "COUNT";
  else if (d.stable === true) status = "STABLE";
  else status = "UNSTABLE";

  const valueText = value === null ? "" : (textFromWeight(d.weight) ?? String(value));

  return {
    value,
    valueText,
    unit: typeof d.unit === "string" ? d.unit.trim() : "",
    status,
    stable: status === "STABLE",
    sim: d.sim === true,
    id: typeof d.id === "string" ? d.id : "",
    device: typeof d.device === "string" ? d.device : "",
    raw: typeof d.raw === "string" ? d.raw : "",
    receivedAt: now.getTime(),
    ...stamp(now),
  };
}

// Reply to CMD:NET:* ({"type":"net",...}); sent only to the client that asked.
export function parseNetMessage(text) {
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return null;
  }
  return d && typeof d === "object" && d.type === "net" ? d : null;
}

// Object passed to window.HR250A_onData(). Same shape as the EK-610i extension's
// reading (value/unit/stable/Status/Date/Time) plus valueText and sim.
export function toWebPayload(r) {
  return {
    device: DEVICE_NAME,
    value: r.value,
    valueText: r.valueText,
    unit: r.unit,
    stable: r.stable,
    Status: r.status,
    Date: r.Date,
    Time: r.Time,
    sim: r.sim,
  };
}
