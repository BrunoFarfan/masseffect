import { Simulation, MAX_BODIES } from "./physics.js";
import { solarSystem, randomBody } from "./solar.js";
import { Camera } from "./camera.js";
import { Renderer, formatDistance } from "./render.js";
import { sub, length, clamp } from "./math.js";

const $ = (id) => document.getElementById(id);
const canvas = $("space"),
  renderer = new Renderer(canvas),
  camera = new Camera();
let sim = new Simulation(solarSystem()),
  selected = "earth",
  playing = true,
  visitor = 0,
  last = 0,
  uiTime = 0,
  drag = null,
  toastTimer;
let rateWindow = 0,
  rateStart = 0,
  actualRate = 604800,
  limited = false,
  windowLimited = false;
const keys = new Set(),
  options = { trails: true, reference: true, labels: true };
const isEditing = () =>
  !!document.querySelector("dialog[open]") ||
  ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName);
camera.aspect = innerWidth / innerHeight;
camera.home();
if (innerWidth < 650) $("body-details").open = false;

function toast(text) {
  $("toast").textContent = text;
  $("toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("visible"), 3500);
}
function populate() {
  const select = $("body-select");
  select.replaceChildren(...sim.bodies.map((b) => new Option(b.name, b.id)));
  select.value = selected;
  $("add").disabled = $("quick-add").disabled = sim.bodies.length >= MAX_BODIES;
}
function inspect() {
  const body = sim.bodies.find((b) => b.id === selected);
  if (!body) return;
  const sun = sim.bodies.find((b) => b.id === "sun");
  $("properties").innerHTML = [
    ["Mass", `${body.mass.toExponential(2)} kg`],
    ["Radius", formatDistance(body.radius)],
    ["Speed", `${(length(body.velocity) / 1000).toFixed(1)} km/s`],
    [
      "Distance to Sun",
      sun ? formatDistance(length(sub(body.position, sun.position))) : "—",
    ],
  ]
    .map(
      ([label, value]) =>
        `<div class="property"><small>${label}</small><strong>${value}</strong></div>`,
    )
    .join("");
  $("clock").textContent =
    `DAY ${Math.floor(sim.time / 86400).toLocaleString("en")}`;
  const editing = !!document.querySelector("dialog[open]");
  $("running").textContent = editing
    ? "Paused · editing"
    : !playing
      ? "Paused"
      : limited
        ? `${(actualRate / 86400).toFixed(1)} days/sec · accuracy protected`
        : "Running";
  $("running").title =
    playing && !editing
      ? `Achieved ${(actualRate / 86400).toFixed(2)} simulated days per real second. Requested ${Number($("speed").value) / 86400}.`
      : "";
  $("camera-mode").textContent = camera.followId
    ? `Following ${sim.bodies.find((b) => b.id === camera.followId)?.name || "body"}`
    : "Free camera";
  $("focus").textContent =
    camera.followId === selected ? "↙ Release camera" : "↗ Follow body";
  options.occlusions = ["header", ".inspector", "footer", ".experiment"].map(
    (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x - 6, y: r.y - 6, w: r.width + 12, h: r.height + 12 };
    },
  );
  const target = camera.locator(body.position, innerWidth, innerHeight);
  $("locator").hidden = !target || editing;
  if (target) {
    // Keep the return affordance clear of the left-hand inspector.
    const inspector = document
      .querySelector(".inspector")
      .getBoundingClientRect();
    if (target.x < inspector.right + 110 && target.y < inspector.bottom + 30)
      target.y = Math.min(innerHeight - 150, inspector.bottom + 30);
    $("locator").style.left = `${target.x}px`;
    $("locator").style.top = `${target.y}px`;
    $("locator-arrow").style.transform = `rotate(${target.angle}rad)`;
    $("locator-label").textContent =
      `${body.name}${target.behind ? " · behind you" : ""}`;
    $("locator").setAttribute("aria-label", `Find ${body.name}`);
  }
}
function select(id) {
  if (!id) return;
  selected = id;
  $("body-select").value = id;
  inspect();
}
function resetRate() {
  rateWindow = 0;
  rateStart = sim.time;
  windowLimited = false;
  limited = false;
  actualRate = Number($("speed").value);
}
function setPlaying(value) {
  playing = value;
  resetRate();
  $("play").textContent = playing ? "Ⅱ" : "▶";
  $("play").setAttribute(
    "aria-label",
    playing ? "Pause simulation" : "Play simulation",
  );
  inspect();
}
$("play").onclick = () => setPlaying(!playing);
$("body-select").onchange = (e) => select(e.target.value);
$("focus").onclick = () => {
  if (camera.followId === selected) camera.release();
  else camera.focus(sim.bodies.find((b) => b.id === selected));
};
$("home").onclick = () => camera.home(false, true);
$("outer").onclick = () => camera.home(true, true);
$("speed").onchange = () => {
  sim.pending = 0;
  resetRate();
};
for (const name of ["trails", "reference", "labels"])
  $(name).onclick = () => {
    options[name] = !options[name];
    $(name).setAttribute("aria-pressed", options[name]);
  };
$("reset").onclick = () => {
  sim = new Simulation(solarSystem());
  selected = "earth";
  visitor = 0;
  resetRate();
  camera.home(false, true);
  populate();
  inspect();
  toast("A fresh beginning. Solar System restored.");
};
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => button.closest("dialog").close();
$("help").onclick = () => {
  keys.clear();
  $("help-dialog").showModal();
};
$("locator").onclick = () =>
  camera.focus(sim.bodies.find((b) => b.id === selected));
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("close", () => {
    resetRate();
    inspect();
  });
$("add").onclick = () => {
  keys.clear();
  $("create-dialog").showModal();
};
function releaseBody(b) {
  b.trailInterval = clamp(
    (2 * Math.PI * length(b.position)) / Math.max(length(b.velocity), 1) / 500,
    60,
    2e7,
  );
  b.lastTrailTime = sim.time;
  b.trail.push([...b.position]);
  sim.bodies.push(b);
  selected = b.id;
  populate();
  inspect();
  toast(`${b.name} released. Follow it to explore.`);
}
$("quick-add").onclick = () => {
  if (sim.bodies.length < MAX_BODIES) releaseBody(randomBody(++visitor));
};
$("randomize").onclick = () => {
  const b = randomBody(visitor + 1),
    form = $("create-form");
  for (const [key, value] of Object.entries({
    name: b.name,
    mass: b.mass.toExponential(3),
    radius: b.radius.toExponential(3),
    px: b.position[0].toExponential(3),
    py: b.position[1].toExponential(3),
    pz: b.position[2].toExponential(3),
    vx: Math.round(b.velocity[0]),
    vy: Math.round(b.velocity[1]),
    vz: Math.round(b.velocity[2]),
  }))
    form.elements[key].value = value;
};
$("create-form").onsubmit = (e) => {
  e.preventDefault();
  if (sim.bodies.length >= MAX_BODIES) return;
  const data = new FormData(e.target),
    number = (name) => Number(data.get(name));
  const b = {
    id: `visitor-${++visitor}`,
    name: data.get("name").trim() || `Visitor ${visitor}`,
    kind: "Visitor",
    color: "#c4b4df",
    mass: number("mass"),
    radius: number("radius"),
    position: ["px", "py", "pz"].map(number),
    velocity: ["vx", "vy", "vz"].map(number),
    trail: [],
  };
  if (![b.mass, b.radius, ...b.position, ...b.velocity].every(Number.isFinite))
    return;
  releaseBody(b);
  $("create-dialog").close();
};
canvas.onpointerdown = (e) => {
  canvas.focus();
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, distance: 0 };
};
canvas.onpointermove = (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  drag.distance += Math.hypot(dx, dy);
  camera.rotate(dx, dy);
  drag.x = e.clientX;
  drag.y = e.clientY;
};
canvas.onpointerup = (e) => {
  if (drag?.id === e.pointerId && drag.distance < 5)
    select(renderer.pick(e.clientX, e.clientY));
  drag = null;
};
canvas.onpointercancel = () => {
  drag = null;
};
canvas.onlostpointercapture = () => {
  drag = null;
};
canvas.ondblclick = (e) => {
  const id = renderer.pick(e.clientX, e.clientY);
  if (id) {
    select(id);
    camera.focus(sim.bodies.find((b) => b.id === id));
  }
};
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    camera.travel(
      clamp(-e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.001, -0.4, 0.4),
      sim.bodies,
    );
  },
  { passive: false },
);
window.addEventListener("keydown", (e) => {
  if (isEditing()) return;
  const key = e.key.toLowerCase();
  if (key === " " && document.activeElement?.tagName === "BUTTON") return;
  if (["w", "a", "s", "d", "q", "e", "shift", " ", "h"].includes(key))
    e.preventDefault();
  keys.add(key);
  if (e.repeat) return;
  if (key === " ") setPlaying(!playing);
  if (key === "h") camera.home(false, true);
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  keys.clear();
  drag = null;
});
document.addEventListener("visibilitychange", () => {
  keys.clear();
  last = 0;
  resetRate();
});
window.addEventListener("resize", () => {
  renderer.resize();
  camera.aspect = innerWidth / innerHeight;
});
function frame(now) {
  const rawDt = last ? (now - last) / 1000 : 0,
    dt = Math.min(rawDt, 0.05);
  last = now;
  if (playing && !document.querySelector("dialog[open]") && !document.hidden) {
    sim.advance(dt, Number($("speed").value));
    rateWindow += rawDt;
    windowLimited ||= sim.limited;
    if (rateWindow >= 0.75) {
      actualRate = (sim.time - rateStart) / rateWindow;
      limited = windowLimited || actualRate < Number($("speed").value) * 0.9;
      rateWindow = 0;
      rateStart = sim.time;
      windowLimited = false;
    }
  }
  if (sim.events.length) {
    for (const event of sim.events) {
      if (selected === event.removed) selected = event.survivor;
      if (camera.followId === event.removed) {
        camera.followId = null;
        camera.previousTarget = null;
      }
      toast(event.text);
    }
    sim.events = [];
    populate();
  }
  camera.update(dt, sim.bodies, keys);
  renderer.draw(sim, camera, selected, options);
  if (now - uiTime > 150) {
    inspect();
    uiTime = now;
  }
  requestAnimationFrame(frame);
}
populate();
inspect();
requestAnimationFrame(frame);
