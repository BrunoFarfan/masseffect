import test from "node:test";
import assert from "node:assert/strict";
import {
  MouseLook,
  mousePreferences,
  preferRawMouse,
  requestMouseLock,
} from "../src/mouse-look.js";
import { Camera } from "../src/camera.js";

test("mouse-look preserves both diagonal axes and fractional input at high polling rates", () => {
  for (const samples of [125, 1000, 8000]) {
    const look = new MouseLook();
    for (let i = 0; i < samples; i++) look.add(20 / samples, -10 / samples);
    const [x, y] = look.consume();
    assert.ok(Math.abs(x - 20) < 1e-10);
    assert.ok(Math.abs(y + 10) < 1e-10);
    assert.deepEqual(look.consume(), [0, 0]);
  }
});

test("separately delivered axes combine into one diagonal turn without normalizing motion", () => {
  const look = new MouseLook(),
    camera = new Camera();
  camera.yaw = camera.pitch = 0;
  look.add(10, 0);
  look.add(0, 5);
  const [x, y] = look.consume();
  camera.rotate(x, -y);
  assert.equal(camera.yaw, 0.02);
  assert.equal(camera.pitch, -0.01);
});

test("mouse delta totals do not depend on rendering cadence", () => {
  for (const frames of [30, 60, 120]) {
    const look = new MouseLook(),
      camera = new Camera();
    camera.yaw = camera.pitch = 0;
    for (let frame = 0; frame < frames; frame++) {
      for (let sample = 0; sample < 10; sample++)
        look.add(50 / frames / 10, 25 / frames / 10);
      const [x, y] = look.consume();
      camera.rotate(x, -y);
    }
    assert.ok(Math.abs(camera.yaw - 0.1) < 1e-12);
    assert.ok(Math.abs(camera.pitch + 0.05) < 1e-12);
  }
});

test("input reset discards queued look on escape/blur and rejects nonfinite samples", () => {
  const look = new MouseLook();
  look.add(100, 80);
  look.clear();
  look.add(NaN, 1);
  look.add(1, Infinity);
  assert.deepEqual(look.consume(), [0, 0]);
  look.sensitivity = 0.5;
  look.add(10, 5);
  assert.deepEqual(look.consume(), [5, 2.5]);
});

test("Auto only prefers raw input for Firefox/Linux and preserves macOS defaults", () => {
  assert.equal(
    preferRawMouse("auto", "X11; Linux x86_64; Firefox/152.0"),
    true,
  );
  assert.equal(preferRawMouse("auto", "Macintosh; Chrome/150.0"), false);
  assert.equal(preferRawMouse("auto", "Macintosh; Firefox/152.0"), false);
  assert.equal(
    preferRawMouse("auto", "X11; Linux x86_64; Chrome/150.0"),
    false,
  );
  assert.equal(
    preferRawMouse("system", "X11; Linux x86_64; Firefox/152.0"),
    false,
  );
  assert.equal(preferRawMouse("raw", "Macintosh; Chrome/150.0"), true);
});

test("mouse preferences validate browser storage and clamp sensitivity", () => {
  for (const value of [null, {}, "bad", { mode: "bad", sensitivity: NaN }])
    assert.deepEqual(mousePreferences(value), { mode: "auto", sensitivity: 1 });
  assert.deepEqual(mousePreferences({ mode: "raw", sensitivity: 100 }), {
    mode: "raw",
    sensitivity: 4,
  });
  assert.equal(mousePreferences({ sensitivity: -1 }).sensitivity, 0.25);
});

test("raw input is explicitly requested and acknowledged by a supported browser", async () => {
  const calls = [];
  const status = await requestMouseLock(
    {
      requestPointerLock: async (options) => {
        calls.push(options);
      },
    },
    true,
  );
  assert.deepEqual(calls, [{ unadjustedMovement: true }]);
  assert.equal(status, "Raw input");
});

test("unsupported raw input falls back once to system pointer lock", async () => {
  const calls = [];
  const status = await requestMouseLock(
    {
      requestPointerLock: async (options) => {
        calls.push(options);
        if (options)
          throw Object.assign(new Error("raw unsupported"), {
            name: "NotSupportedError",
          });
      },
    },
    true,
  );
  assert.deepEqual(calls, [{ unadjustedMovement: true }, undefined]);
  assert.equal(status, "Raw unavailable; using system input");
});

test("permission/gesture failures do not retry and legacy support is not falsely confirmed", async () => {
  let calls = 0;
  await assert.rejects(
    requestMouseLock(
      {
        requestPointerLock: async () => {
          calls++;
          throw Object.assign(new Error("gesture required"), {
            name: "SecurityError",
          });
        },
      },
      true,
    ),
    { name: "SecurityError" },
  );
  assert.equal(calls, 1);
  assert.equal(
    await requestMouseLock({ requestPointerLock: () => undefined }, true),
    "Raw requested; browser cannot confirm support",
  );
  assert.equal(
    await requestMouseLock({ requestPointerLock: () => undefined }, false),
    "System input",
  );
});
