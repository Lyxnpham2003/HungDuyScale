// Decides when a reading is sent to the web page: once per stabilization,
// never for an empty pan, and not again for the same value until the pan
// goes back to (near) zero.

export function createPushGate({ minWeight = 0.001 } = {}) {
  let armed = true;
  let lastPushedText = null;

  function decide(r) {
    if (r.status === "OVERLOAD") {
      armed = true;
      return "skip";
    }
    if (r.status === "COUNT" || r.unit !== "g") return "skip";

    if (r.value <= minWeight) {
      // Empty pan (or negative after tare): next sample may be pushed, even if identical
      armed = true;
      lastPushedText = null;
      return "skip";
    }
    if (r.status === "UNSTABLE") {
      armed = true;
      return "skip";
    }

    // STABLE, above threshold
    if (!armed || r.valueText === lastPushedText) return "skip";
    armed = false;
    lastPushedText = r.valueText;
    return "push";
  }

  function reset() {
    armed = true;
    lastPushedText = null;
  }

  return { decide, reset };
}
