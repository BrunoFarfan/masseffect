// Mouse deltas are device/browser input, not SI simulation state. Never round,
// normalize, dead-zone or select a dominant axis: small diagonal motion matters.
export class MouseLook {
  constructor() {
    this.sensitivity = 1;
    this.clear();
  }
  clear() {
    this.x = this.y = 0;
  }
  add(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.x += x;
    this.y += y;
  }
  consume() {
    const delta = [this.x * this.sensitivity, this.y * this.sensitivity];
    this.clear();
    return delta;
  }
}

export function mousePreferences(value = {}) {
  return {
    mode: ["auto", "system", "raw"].includes(value?.mode) ? value.mode : "auto",
    sensitivity: Number.isFinite(value?.sensitivity)
      ? Math.max(0.25, Math.min(4, value.sensitivity))
      : 1,
  };
}

export function preferRawMouse(mode, userAgent) {
  // Auto targets the reported Firefox/Linux path, not an assumed Wayland
  // detection. Preserve system/trackpad acceleration on other platforms.
  return (
    mode === "raw" ||
    (mode === "auto" && /Firefox\//.test(userAgent) && /Linux/.test(userAgent))
  );
}

export async function requestMouseLock(element, raw) {
  if (!raw) {
    await element.requestPointerLock();
    return "System input";
  }
  try {
    const request = element.requestPointerLock({ unadjustedMovement: true });
    // Legacy APIs may silently ignore the option; do not claim raw succeeded.
    if (!request?.then) return "Raw requested; browser cannot confirm support";
    await request;
    return "Raw input";
  } catch (error) {
    if (error.name !== "NotSupportedError") throw error;
    await element.requestPointerLock();
    return "Raw unavailable; using system input";
  }
}
