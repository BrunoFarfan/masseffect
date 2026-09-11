import test from "node:test";
import assert from "node:assert/strict";
import { Simulation, mergeCollisions, MAX_BODIES } from "../src/physics.js";
import { History } from "../src/history.js";
import { impactScenario } from "../src/impact-scenario.js";

const state = (bodies) =>
  bodies.map(
    ({ id, mass, radius, position, velocity, fragmentGeneration }) => ({
      id,
      mass,
      radius,
      position,
      velocity,
      fragmentGeneration,
    }),
  );
const contactPair = () => {
  const { bodies } = impactScenario();
  bodies[0].position = [-bodies[0].radius, 0, 0];
  bodies[1].position = [bodies[1].radius, 0, 0];
  return bodies;
};
const bystander = (id, index, extra = {}) => ({
  id,
  name: id,
  kind: "Asteroid",
  mass: 1e12,
  radius: 1000,
  position: [1e12 + index * 1e10, 1e12, 0],
  velocity: [0, 0, 0],
  trail: [],
  relativeTrail: [[1, 2, 3]],
  ...extra,
});

test("Simulation impact history restores two originals, seeks four fragments and branches through impact again", () => {
  const sim = new Simulation(impactScenario().bodies);
  const history = new History(sim);
  const original = structuredClone(state(sim.bodies));
  let beforeTime = 0,
    beforeBodies = original;
  for (let frame = 0; frame < 200 && sim.bodies.length === 2; frame++) {
    beforeTime = sim.time;
    beforeBodies = structuredClone(state(sim.bodies));
    sim.advance(0.1, 600, 1000);
    history.capture(sim);
  }
  assert.equal(sim.bodies.length, 4);
  assert.ok(sim.events.some((event) => event.text.includes("four fragments")));
  const afterTime = sim.time,
    fragments = structuredClone(state(sim.bodies));
  assert.ok(fragments.every((body) => body.fragmentGeneration === 1));
  history.rewind(sim, afterTime - beforeTime);
  assert.equal(sim.time, beforeTime);
  assert.deepEqual(state(sim.bodies), beforeBodies);
  assert.equal(sim.events.length, 0);
  assert.equal(sim.pending, 0);
  history.seek(sim, afterTime);
  assert.deepEqual(state(sim.bodies), fragments);
  history.seek(sim, 0);
  assert.deepEqual(state(sim.bodies), original);
  history.seek(sim, beforeTime);
  for (let frame = 0; frame < 20 && sim.bodies.length === 2; frame++) {
    sim.advance(0.1, 600, 1000);
    history.capture(sim);
  }
  assert.equal(sim.bodies.length, 4);
  assert.deepEqual(
    sim.bodies.map((body) => body.id),
    fragments.map((body) => body.id),
  );
  assert.ok(sim.bodies.every((body) => body.fragmentGeneration === 1));
  assert.equal(
    sim.bodies.reduce((total, body) => total + body.mass, 0),
    original.reduce((total, body) => total + body.mass, 0),
  );
  assert.equal(history.newestTime, sim.time);
});

test("a heavier ordinary body absorbing a fragment retains generation through history and cannot disrupt again", () => {
  const fragments = contactPair();
  mergeCollisions(fragments);
  assert.equal(fragments.length, 4);
  const fragment = fragments[0];
  const ordinary = {
    ...fragment,
    id: "ordinary",
    name: "Ordinary",
    kind: "Planet",
    mass: fragment.mass * 2,
    fragmentGeneration: undefined,
    position: [...fragment.position],
    velocity: [1e5, 0, 0],
    trail: [],
  };
  const sim = new Simulation([fragment, ordinary]);
  const history = new History(sim);
  assert.equal(mergeCollisions(sim.bodies).length, 1);
  assert.equal(sim.bodies.length, 1);
  assert.equal(sim.bodies[0].id, "ordinary");
  assert.equal(sim.bodies[0].fragmentGeneration, 1);
  sim.time = 1;
  history.capture(sim);
  history.seek(sim, 0);
  assert.equal(sim.bodies.length, 2);
  assert.equal(
    sim.bodies.find((body) => body.id === fragment.id).fragmentGeneration,
    1,
  );
  history.seek(sim, 1);
  const survivor = sim.bodies[0];
  assert.equal(survivor.fragmentGeneration, 1);
  sim.bodies.push({
    ...survivor,
    id: "new-impact",
    name: "New impact",
    fragmentGeneration: undefined,
    position: [...survivor.position],
    velocity: [-1e5, 0, 0],
    trail: [],
  });
  assert.equal(mergeCollisions(sim.bodies).length, 1);
  assert.equal(sim.bodies.length, 1);
  assert.equal(sim.bodies[0].fragmentGeneration, 1);
});

test("integrated collision resolution respects the 128-body cap at both boundary counts", () => {
  for (const count of [MAX_BODIES - 2, MAX_BODIES]) {
    const bodies = contactPair();
    for (let i = bodies.length; i < count; i++)
      bodies.push(bystander(`distant-${i}`, i));
    const mass = bodies.reduce((total, body) => total + body.mass, 0);
    assert.equal(mergeCollisions(bodies).length, 1);
    assert.equal(
      bodies.length,
      count === MAX_BODIES ? MAX_BODIES - 1 : MAX_BODIES,
    );
    assert.equal(
      bodies.filter((body) => body.kind === "Fragment").length,
      count === MAX_BODIES ? 0 : 4,
    );
    const afterMass = bodies.reduce((total, body) => total + body.mass, 0);
    assert.ok(Math.abs(afterMass / mass - 1) < 1e-13);
    assert.equal(new Set(bodies.map((body) => body.id)).size, bodies.length);
  }
});

test("fragmenting parents detach external children and retain only an existing shared primary", () => {
  const bodies = contactPair();
  bodies.forEach((body) => {
    body.parentId = "external-sun";
  });
  const primary = bystander("external-sun", 10, { kind: "Star", mass: 1e30 });
  const children = bodies.map((body, i) =>
    bystander(`child-${i}`, i, { parentId: body.id }),
  );
  const unrelated = bystander("unrelated", 20, { parentId: primary.id });
  bodies.push(primary, ...children, unrelated);
  assert.equal(mergeCollisions(bodies).length, 1);
  assert.equal(bodies.filter((body) => body.kind === "Fragment").length, 4);
  for (const child of children) {
    assert.equal(child.parentId, undefined);
    assert.deepEqual(child.relativeTrail, []);
  }
  assert.equal(unrelated.parentId, primary.id);
  assert.deepEqual(unrelated.relativeTrail, [[1, 2, 3]]);
  for (const fragment of bodies.filter((body) => body.kind === "Fragment"))
    assert.equal(fragment.parentId, primary.id);
  const missingParent = contactPair();
  missingParent.forEach((body) => {
    body.parentId = "missing";
  });
  mergeCollisions(missingParent);
  assert.ok(missingParent.every((body) => body.parentId === undefined));
});
