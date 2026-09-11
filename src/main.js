import { Simulation, MAX_BODIES } from "./physics.js";
import { solarSystem } from "./solar.js";
import { Camera } from "./camera.js";
import { Renderer, formatDistance } from "./render.js";
import { sub, length, clamp } from "./math.js";
import { PRESETS, createPlacedBody, randomPlacement } from "./presets.js";
import { SCENARIOS, createScenario } from "./scenarios.js";
import { History } from "./history.js";
import { equilibriumTemperature, stellarColor } from "./thermal.js";
import { initializeRotations, rotateVector, between } from "./rotation.js";
import {
  MouseLook,
  mousePreferences,
  preferRawMouse,
  requestMouseLock,
} from "./mouse-look.js";
const $ = (id) => document.getElementById(id),
  canvas = $("space"),
  camera = new Camera(),
  renderer = new Renderer(canvas);
const mouseLook = new MouseLook();
let mouseSettings = mousePreferences(),
  requestingMouseLock = false;
try {
  mouseSettings = mousePreferences(
    JSON.parse(localStorage.getItem("mass-effect.mouse-look")),
  );
} catch {
  /* Storage can be disabled; defaults remain usable. */
}
mouseLook.sensitivity = mouseSettings.sensitivity;
let sim = new Simulation(solarSystem()),
  selected = null,
  playing = true,
  visitor = 0,
  last = 0,
  uiTime = 0,
  entered = false,
  toastTimer;
let history = new History(sim),
  historyCadence = 0,
  reversing = false;
let rateWindow = 0,
  rateStart = 0,
  actualRate = 86400,
  limited = false,
  windowLimited = false;
const keys = new Set(),
  options = { trails: true, labels: true };
function clearMovement() {
  keys.clear();
  camera.stop();
  mouseLook.clear();
}
const locked = () => document.pointerLockElement === canvas,
  modal = () => document.querySelector("dialog[open]");
camera.aspect = innerWidth / innerHeight;
camera.home();
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3500);
}
function clearToast() {
  clearTimeout(toastTimer);
  $("toast").textContent = "";
  $("toast").classList.remove("visible");
}
function timeSpan(seconds) {
  seconds = Math.max(0, seconds);
  return seconds < 3600
    ? Math.round(seconds) + " s"
    : seconds < 86400
      ? (seconds / 3600).toFixed(1) + " h"
      : (seconds / 86400).toFixed(1) + " d";
}
function resetRate() {
  rateWindow = 0;
  rateStart = sim.time;
  actualRate = Number($("speed").value);
  limited = windowLimited = false;
}
function orderedBodies() {
  const result = [],
    seen = new Set();
  function append(b, depth) {
    if (seen.has(b.id)) return;
    seen.add(b.id);
    result.push({ b, depth });
    for (const child of sim.bodies.filter((c) => c.parentId === b.id))
      append(child, depth + 1);
  }
  for (const b of sim.bodies.filter(
    (b) => !sim.bodies.some((p) => p.id === b.parentId),
  ))
    append(b, 0);
  for (const b of sim.bodies) append(b, 0);
  return result;
}
function populate() {
  const s = $("body-select");
  s.replaceChildren(
    ...orderedBodies().map(
      ({ b, depth }) =>
        new Option("　".repeat(depth) + (depth ? "↳ " : "") + b.name, b.id),
    ),
  );
  if (selected) s.value = selected;
  $("add").disabled = sim.bodies.length >= MAX_BODIES;
}
function select(id) {
  selected = id || null;
  $("selection").hidden = !selected;
  if (selected) $("body-select").value = selected;
  else $("inspector").hidden = true;
  inspect();
}
function inspect() {
  const b = sim.bodies.find((b) => b.id === selected),
    editing = !!modal();
  $("selection").hidden = !b;
  $("reverse").disabled = sim.time <= history.oldestTime;
  $("reverse").setAttribute("aria-pressed", reversing);
  $("forward").hidden = !reversing;
  $("history-strip").hidden =
    (!reversing && playing) ||
    editing ||
    history.newestTime <= history.oldestTime;
  if (!$("history-strip").hidden) {
    const range = $("history-position");
    range.min = history.oldestTime;
    range.max = history.newestTime;
    range.value = sim.time;
    $("history-start").textContent =
      "−" + timeSpan(sim.time - history.oldestTime);
    $("history-end").textContent =
      "+" + timeSpan(history.newestTime - sim.time);
    range.setAttribute(
      "aria-valuetext",
      "Day " + (sim.time / 86400).toFixed(4),
    );
  }
  $("reverse").title =
    `Recorded rewind available to day ${(history.oldestTime / 86400).toFixed(2)}. Bounded history, not negative-time physics.`;
  $("clock").textContent =
    sim.time < 86400
      ? new Date(Math.max(0, sim.time) * 1000).toISOString().slice(11, 19)
      : `Day ${(sim.time / 86400).toLocaleString("en", { maximumFractionDigits: 1 })}`;
  $("running").textContent =
    editing || !playing
      ? "Paused"
      : reversing
        ? "Recorded rewind"
        : limited
          ? actualRate < 3600
            ? `${actualRate.toFixed(1)}× achieved`
            : `${(actualRate / 86400).toFixed(1)} days/s · CPU limit`
          : "";
  $("running").title =
    `Requested ${Number($("speed").value) / 86400} days/s; achieved ${(actualRate / 86400).toFixed(2)}. Physics slows under load.`;
  $("hint").textContent = locked() ? "Esc · controls" : "Click space · explore";
  $("locator").hidden = true;
  if (b) {
    $("selected-name").textContent = b.name;
    $("selected-context").textContent =
      `${camera.surface ? `${sim.bodies.find((p) => p.id === camera.surface.id)?.name || "Body"} surface · ` : camera.followId ? `${sim.bodies.find((p) => p.id === camera.followId)?.name || "Body"} frame · ` : ""}${formatDistance(Math.max(0, length(sub(camera.position, b.position)) - b.radius))} above ${b.name}`;
    if (!$("inspector").hidden) {
      $("detail-name").textContent = b.name;
      $("properties").innerHTML = [
        ["Mass", `${b.mass.toExponential(2)} kg`],
        ["Radius", formatDistance(b.radius)],
        ["Speed", `${(length(b.velocity) / 1000).toFixed(2)} km/s`],
        [
          "Rotation",
          b.rotationModel === "synchronous"
            ? "Synchronous with primary"
            : b.rotationPeriod === 0
              ? "No axial spin"
              : `${((b.rotationPeriod ?? 86400) / 3600).toFixed(2)} h`,
        ],
        ...(b.kind === "Star"
          ? [
              ["Luminosity", `${(b.luminosity || 0).toExponential(2)} W`],
              [
                "Effective temp.",
                `${Math.round(b.effectiveTemperature || 0).toLocaleString()} K`,
              ],
            ]
          : [
              [
                "Equilibrium temp.",
                `${Math.round(equilibriumTemperature(b, sim.bodies)).toLocaleString()} K`,
              ],
            ]),
      ]
        .map(([a, v]) => `<dt>${a}</dt><dd>${v}</dd>`)
        .join("");
    }
    const t = camera.locator(b.position, innerWidth, innerHeight);
    if (t && !editing && camera.surface?.id !== b.id) {
      $("locator").hidden = false;
      $("locator").style.left = `${t.x}px`;
      $("locator").style.top = `${t.y}px`;
      $("locator-arrow").style.transform = `rotate(${t.angle}rad)`;
      $("locator-label").textContent = b.name + (t.behind ? " · behind" : "");
      $("locator").setAttribute("aria-label", `Find ${b.name}`);
    }
  }
  options.occlusions = [
    document.querySelector("header"),
    document.querySelector("footer"),
    ...(!$("inspector").hidden ? [$("inspector")] : []),
  ].map((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}
function setPlaying(v) {
  // Include the current forward state, even between regular capture ticks.
  if (!v && playing && !reversing) history.capture(sim);
  playing = v;
  resetRate();
  $("play").textContent = v ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    v ? "Pause simulation" : reversing ? "Resume rewind" : "Play simulation",
  );
  inspect();
}
async function navigate() {
  if (requestingMouseLock || locked()) return;
  if (modal()) modal().close();
  requestingMouseLock = true;
  try {
    $("mouse-status").textContent = await requestMouseLock(
      canvas,
      preferRawMouse(mouseSettings.mode, navigator.userAgent),
    );
  } catch {
    $("mouse-status").textContent =
      "Mouse capture failed. Click empty space to retry.";
    toast("Click empty space again to capture the mouse.");
  } finally {
    requestingMouseLock = false;
  }
}
document.addEventListener("pointerlockchange", () => {
  clearMovement();
  if (locked()) {
    entered = true;
    $("welcome").hidden = true;
    document.body.dataset.mode = "navigation";
    canvas.focus();
  } else document.body.dataset.mode = "ui";
  inspect();
});
document.addEventListener("pointerlockerror", () => {
  // Promise rejections handle errors (including a supported system fallback).
  if (!requestingMouseLock) toast("Click empty space to enable mouse-look.");
});
document.addEventListener("mousemove", (e) => {
  if (locked()) mouseLook.add(e.movementX, e.movementY);
});
$("mouse-mode").value = mouseSettings.mode;
$("mouse-sensitivity").value = mouseSettings.sensitivity;
$("mouse-sensitivity-value").textContent =
  `${mouseSettings.sensitivity.toFixed(2)}×`;
function updateMouseSettings() {
  mouseSettings = mousePreferences({
    mode: $("mouse-mode").value,
    sensitivity: Number($("mouse-sensitivity").value),
  });
  mouseLook.sensitivity = mouseSettings.sensitivity;
  mouseLook.clear();
  $("mouse-sensitivity-value").textContent =
    `${mouseSettings.sensitivity.toFixed(2)}×`;
  $("mouse-status").textContent = "Applies on your next click into space.";
  try {
    localStorage.setItem(
      "mass-effect.mouse-look",
      JSON.stringify(mouseSettings),
    );
  } catch {
    /* Preferences still work for this session. */
  }
}
$("mouse-mode").onchange = updateMouseSettings;
$("mouse-sensitivity").oninput = updateMouseSettings;
$("begin").onclick = navigate;
function open(id) {
  clearMovement();
  if (locked()) document.exitPointerLock();
  $(id).showModal();
  inspect();
}
function focus(close = false) {
  if (!selected) select($("body-select").value);
  const b = sim.bodies.find((b) => b.id === selected);
  if (b) {
    camera.focus(b, close ? null : sim.bodies);
    if (modal()) modal().close();
  }
}
$("catalog").onclick = () => open("catalog-dialog");
$("settings").onclick = () => open("view-dialog");
$("keybindings").onclick = () => open("keys-dialog");
$("add").onclick = () => {
  prepareCreation();
  open("create-dialog");
};
$("body-select").onchange = (e) => select(e.target.value);
$("body-select").ondblclick = () => focus();
$("catalog-focus").onclick =
  $("focus").onclick =
  $("locator").onclick =
    () => focus();
$("catalog-approach").onclick = $("approach").onclick = () => focus(true);
$("details").onclick = () => {
  $("inspector").hidden = !$("inspector").hidden;
  inspect();
};
$("close-details").onclick = () => ($("inspector").hidden = true);
$("clear-selection").onclick = () => select(null);
$("unfollow").onclick = () => {
  camera.release();
  inspect();
};
$("play").onclick = () => setPlaying(!playing);
function playForward() {
  reversing = false;
  setPlaying(true);
}
function rewind() {
  if (sim.time <= history.oldestTime) return;
  clearToast();
  renderer.impacts.clear();
  if (!reversing) history.capture(sim);
  reversing = true;
  sim.pending = 0;
  setPlaying(true);
}
$("forward").onclick = playForward;
$("reverse").onclick = rewind;
function restoredSelection() {
  if (!sim.bodies.some((b) => b.id === selected)) select(null);
  if (!sim.bodies.some((b) => b.id === camera.followId)) camera.release();
  populate();
}
$("history-position").oninput = (e) => {
  const target = Number(e.target.value);
  clearToast();
  renderer.impacts.clear();
  reversing = true;
  setPlaying(false);
  history.seek(sim, target);
  restoredSelection();
  inspect();
};
$("speed").onchange = () => {
  sim.pending = 0;
  resetRate();
};
function changeSpeed(direction) {
  const speed = $("speed");
  speed.selectedIndex = clamp(
    speed.selectedIndex + direction,
    0,
    speed.options.length - 1,
  );
  speed.onchange();
  inspect();
}
$("home").onclick = () => {
  camera.home(false, true);
  if (modal()) modal().close();
};
$("outer").onclick = () => {
  camera.home(true, true);
  if (modal()) modal().close();
};
for (const n of ["trails", "labels"])
  $(n).onclick = () => {
    options[n] = !options[n];
    $(n).setAttribute("aria-pressed", options[n]);
  };
$("reset").onclick = () => {
  renderer.impacts.clear();
  sim = new Simulation(solarSystem());
  history.clear(sim);
  reversing = false;
  setPlaying(true);
  $("scenario-name").textContent = "";
  visitor = 0;
  select(null);
  camera.home(false, true);
  populate();
  resetRate();
  if (modal()) modal().close();
  toast("Solar System restored.");
};
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => b.closest("dialog").close();
for (const d of document.querySelectorAll("dialog"))
  d.addEventListener("close", () => {
    clearMovement();
    resetRate();
    inspect();
  });
function releaseBody(b) {
  b.trailInterval ??= clamp(
    (2 * Math.PI * length(b.position)) / Math.max(length(b.velocity), 1) / 500,
    30,
    2e7,
  );
  b.lastTrailTime = sim.time;
  b.trail = [[...b.position]];
  if (b.kind === "Star" && b.effectiveTemperature)
    b.color = stellarColor(b.effectiveTemperature);
  sim.bodies.push(b);
  initializeRotations(sim.bodies);
  history.capture(sim);
  reversing = false;
  populate();
  select(b.id);
  const parent = sim.bodies.find((p) => p.id === b.parentId);
  camera.focus(parent || b, parent ? [b] : null);
  toast(`${b.name} released`);
}
let placement = randomPlacement();
$("preset").replaceChildren(...PRESETS.map((p) => new Option(p.name, p.id)));
$("preset").value = "earth";
function placed() {
  let draw = 0;
  const base = PRESETS.find((p) => p.id === $("preset").value).name;
  let name = base;
  for (let suffix = 2; sim.bodies.some((b) => b.name === name); suffix++)
    name = base + " " + suffix;
  return createPlacedBody(
    {
      presetId: $("preset").value,
      primary: sim.bodies.find((b) => b.id === $("primary").value),
      distance: Number($("distance").value) * Number($("distance-unit").value),
      inclination: (Number($("inclination").value) * Math.PI) / 180,
      phase: placement.phase,
      name,
      speedMode: $("motion").value,
      id: "preview",
    },
    () => placement.samples[draw++],
  );
}
function updatePreview(frame = false) {
  $("inclination-value").textContent = $("inclination").value + "°";
  try {
    const b = placed();
    options.preview = $("advanced").open ? null : b;
    $("creation-error").textContent = "";
    if (frame) {
      const primary = sim.bodies.find((p) => p.id === b.parentId);
      camera.focus(primary, [b]);
    }
    return b;
  } catch (error) {
    options.preview = null;
    $("creation-error").textContent = $("advanced").open ? "" : error.message;
    return null;
  }
}
function prepareCreation() {
  placement = randomPlacement();
  $("primary").replaceChildren(
    ...orderedBodies().map(({ b }) => new Option(b.name, b.id)),
  );
  $("primary").value =
    selected ||
    sim.bodies.find((b) => b.kind === "Star")?.id ||
    sim.bodies[0].id;
  $("advanced").open = false;
  $("advanced-fields").disabled = true;
  defaultDistance();
}
function defaultDistance() {
  const primary = sim.bodies.find((b) => b.id === $("primary").value);
  const stellar = primary.kind === "Star";
  $("distance-unit").value = stellar ? "149597870700" : "1000";
  $("distance").value = stellar ? 1 : Math.round((primary.radius * 60) / 1000);
  updatePreview(true);
}
$("primary").onchange = defaultDistance;
for (const id of [
  "preset",
  "distance",
  "distance-unit",
  "motion",
  "inclination",
])
  $(id).oninput = () =>
    updatePreview(id === "distance" || id === "distance-unit");
$("placement-angle").onclick = () => {
  placement = randomPlacement();
  updatePreview(true);
};
$("advanced").ontoggle = () => {
  $("advanced-fields").disabled = !$("advanced").open;
  for (const id of [
    "preset",
    "primary",
    "distance",
    "distance-unit",
    "motion",
    "inclination",
    "placement-angle",
  ])
    $(id).disabled = $("advanced").open;
  $("creation-note").textContent = $("advanced").open
    ? "World coordinates in SI · Y is up. Untouched values retain full precision."
    : "Time pauses while placing. The arrow shows initial relative velocity.";
  if ($("advanced").open) {
    const b = updatePreview();
    if (b)
      for (const [k, v] of Object.entries({
        name: b.name,
        mass: b.mass,
        radius: b.radius,
        px: b.position[0],
        py: b.position[1],
        pz: b.position[2],
        vx: b.velocity[0],
        vy: b.velocity[1],
        vz: b.velocity[2],
      })) {
        const input = $("create-form").elements[k];
        input.value = typeof v === "number" ? v.toExponential(4) : v;
        input.dataset.exact = String(v);
        input.dataset.display = input.value;
        input.title = String(v);
      }
  } else updatePreview();
};
$("create-dialog").addEventListener("close", () => {
  options.preview = null;
});
$("create-form").onsubmit = (e) => {
  e.preventDefault();
  if (sim.bodies.length >= MAX_BODIES) return;
  let b = updatePreview();
  if ($("advanced").open) {
    const d = new FormData(e.target),
      n = (k) => {
        const input = e.target.elements[k];
        return Number(
          input.value === input.dataset.display
            ? input.dataset.exact
            : d.get(k),
        );
      };
    b = {
      ...PRESETS.find((p) => p.id === $("preset").value),
      name: d.get("name").trim() || "Visitor",
      mass: n("mass"),
      radius: n("radius"),
      position: ["px", "py", "pz"].map(n),
      velocity: ["vx", "vy", "vz"].map(n),
      trail: [],
    };
  }
  if (
    !b ||
    ![b.mass, b.radius, ...b.position, ...b.velocity].every(Number.isFinite)
  )
    return;
  if ($("advanced").open && b.kind === "Star")
    b.luminosity =
      4 *
      Math.PI *
      5.670374419e-8 *
      b.radius ** 2 *
      b.effectiveTemperature ** 4;
  b.id = "visitor-" + ++visitor;
  releaseBody(b);
  $("create-dialog").close();
};
function loadScenario(id) {
  clearToast();
  renderer.impacts.clear();
  camera.home();
  const state = createScenario(id);
  sim = new Simulation(state.bodies);
  for (const b of sim.bodies)
    if (b.kind === "Star" && b.effectiveTemperature)
      b.color = stellarColor(b.effectiveTemperature);
  history.clear(sim);
  reversing = false;
  $("scenario-name").textContent =
    id === "solar-system" ? "" : SCENARIOS.find((s) => s.id === id).name;
  visitor = 0;
  populate();
  select(state.focusId);
  if (
    ![...$("speed").options].some((o) => Number(o.value) === state.timeScale)
  ) {
    const next = [...$("speed").options].find(
      (o) => Number(o.value) > state.timeScale,
    );
    $("speed").add(
      new Option(timeSpan(state.timeScale) + " / s", state.timeScale),
      next || null,
    );
  }
  $("speed").value = String(state.timeScale);
  setPlaying(true);
  const b = sim.bodies.find((b) => b.id === state.focusId);
  camera.transition = null;
  camera.position = b.position.map(
    (v, k) => v + [0.18, 0.64, 0.78][k] * state.cameraDistance,
  );
  camera.lookAt(b.position);
  camera.followId = b.id;
  camera.previousTarget = [...b.position];
  if (state.surfaceView) {
    const local = state.surfaceView.normal;
    const normal = rotateVector(b.orientation, local);
    camera.position = b.position.map(
      (v, k) => v + normal[k] * (b.radius + state.surfaceView.altitude),
    );
    camera.frameRotation = between([0, 1, 0], normal);
    camera.lookAt(
      sim.bodies.find((p) => p.id === state.surfaceView.lookAt).position,
    );
    camera.updateSurface(0, sim.bodies);
    if (camera.surface) camera.surface.blend = 1;
  }
  if (modal()) modal().close();
  $("welcome").hidden = true;
  entered = true;
  resetRate();
}
$("scenes").onclick = () => open("scenario-dialog");
for (const scene of SCENARIOS) {
  const b = document.createElement("button"),
    name = document.createElement("span"),
    description = document.createElement("small");
  name.textContent = scene.name;
  description.textContent = scene.description;
  b.append(name, description);
  b.onclick = () => loadScenario(scene.id);
  $("scenario-list").append(b);
}
canvas.onclick = (e) => {
  if (locked()) {
    select(renderer.pick(innerWidth / 2, innerHeight / 2));
    return;
  }
  const id = renderer.pick(e.clientX, e.clientY);
  if (entered && id) select(id);
  else navigate();
};
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camera.travel(
      clamp(-e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.002, -0.5, 0.5),
    );
  },
  { passive: false },
);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    if (locked()) {
      clearMovement();
      document.exitPointerLock();
    }
    return;
  }
  if (
    modal() ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    document.activeElement?.isContentEditable ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)
  )
    return;
  const k = e.key.toLowerCase();
  if (
    /^(Key[WASDQE]|ShiftLeft|ShiftRight)$/.test(e.code) ||
    [" ", "h", "f", "g"].includes(k) ||
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)
  )
    e.preventDefault();
  // Physical key identities remain stable across layout/modifier changes and
  // repeats. Each held key is independent, so releasing one preserves the rest.
  if (locked()) keys.add(e.code);
  if (e.repeat) return;
  if (k === " ") setPlaying(!playing);
  if (k === "h") camera.home(false, true);
  if (k === "f") focus();
  if (k === "g") focus(true);
  if (e.code === "ArrowLeft") rewind();
  if (e.code === "ArrowRight") playForward();
  if (e.code === "ArrowDown") changeSpeed(-1);
  if (e.code === "ArrowUp") changeSpeed(1);
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", clearMovement);
document.addEventListener("visibilitychange", () => {
  clearMovement();
  last = 0;
  resetRate();
});
window.addEventListener("resize", () => {
  renderer.resize();
  camera.aspect = innerWidth / innerHeight;
});
function frame(now) {
  const raw = last ? (now - last) / 1000 : 0,
    dt = Math.min(raw, 0.05);
  last = now;
  if (playing && !modal() && !document.hidden) {
    if (reversing) {
      const ids = sim.bodies.map((b) => b.id).join(",");
      const result = history.rewind(sim, dt * Number($("speed").value));
      if (ids !== sim.bodies.map((b) => b.id).join(",")) {
        if (!sim.bodies.some((b) => b.id === selected)) select(null);
        if (!sim.bodies.some((b) => b.id === camera.followId)) camera.release();
        populate();
      }
      if (result.atStart) {
        setPlaying(false);
        reversing = false;
        toast("Start of recorded history");
      }
    } else {
      const before = sim.time;
      sim.advance(dt, Number($("speed").value));
      historyCadence += raw;
      if (
        sim.time !== before &&
        (historyCadence >= 1 / 30 || sim.events.length)
      ) {
        history.capture(sim);
        historyCadence = 0;
      }
    }
    rateWindow += raw;
    windowLimited ||= sim.limited;
    if (rateWindow >= 2) {
      actualRate = (sim.time - rateStart) / rateWindow;
      limited = windowLimited || actualRate < Number($("speed").value) * 0.9;
      rateWindow = 0;
      rateStart = sim.time;
      windowLimited = false;
    }
  }
  if (sim.events.length) {
    renderer.impacts.capture(sim.events);
    for (const e of sim.events) {
      if (selected === e.removed) selected = e.survivor;
      toast(e.text);
    }
    camera.followSurvivors(sim.events, sim.bodies);
    sim.events = [];
    populate();
  }
  const placing = $("create-dialog").open;
  const offset = placing
    ? -$("create-dialog").getBoundingClientRect().width / 2
    : 0;
  camera.screenOffsetX =
    (camera.screenOffsetX || 0) +
    (offset - (camera.screenOffsetX || 0)) * Math.min(1, dt * 12);
  const [lookX, lookY] = mouseLook.consume();
  if (locked() && (lookX || lookY)) camera.rotate(lookX, -lookY);
  camera.update(dt, sim.bodies, keys);
  options.effectDt =
    playing && !reversing && !modal() && !document.hidden ? dt : 0;
  renderer.draw(sim, camera, placing ? null : selected, options);
  if (now - uiTime > 120) {
    inspect();
    uiTime = now;
  }
  requestAnimationFrame(frame);
}
populate();
inspect();
requestAnimationFrame(frame);
