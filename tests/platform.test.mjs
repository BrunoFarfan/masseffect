import test from "node:test";
import assert from "node:assert/strict";
import { isMobileDevice } from "../src/platform.js";

test("phones and tablets are blocked, including iPad desktop user agents", () => {
  for (const device of [
    { userAgentData: { mobile: true } },
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
    { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)" },
    { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
    {
      userAgent: "Mozilla/5.0 (Linux; Android 15; Tablet)",
      userAgentData: { mobile: false },
    },
    {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    },
  ])
    assert.equal(isMobileDevice(device), true);
});

test("desktop browsers remain supported, including touch laptops", () => {
  for (const device of [
    { platform: "MacIntel", maxTouchPoints: 0 },
    {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      platform: "Win32",
      maxTouchPoints: 10,
    },
    {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
      userAgentData: { mobile: false },
    },
  ])
    assert.equal(isMobileDevice(device), false);
});
