const normalize = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase();

function matchScore(name, needle) {
  const text = normalize(name);
  if (text === needle) return 0;
  if (text.startsWith(needle)) return 1;
  if (text.split(/\s+/).some((word) => word.startsWith(needle))) return 2;
  return text.includes(needle) ? 3 : Infinity;
}

// Bodies own moons, and every body owns its landmarks. Keep one flat list for
// keyboard navigation while carrying paths for a clear visual hierarchy.
export function rankSearch(query, bodies = [], landmarks = {}, limit = 160) {
  const needle = normalize(query);
  const byId = new Map(bodies.map((body) => [body.id, body]));
  const children = new Map();
  for (const body of bodies) {
    const parentId = byId.has(body.parentId) ? body.parentId : null;
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(body);
  }
  const results = [];
  const seen = new Set();
  function append(body, ancestors = []) {
    if (seen.has(body.id)) return;
    seen.add(body.id);
    const name = String(body.name || body.id);
    const path = [...ancestors.map((item) => item.name || item.id), name];
    results.push({
      type: "body", id: body.id, name, body, path,
      parentPath: ancestors.at(-1)?.name || "body",
      depth: ancestors.length,
    });
    for (const [siteIndex, site] of (landmarks[body.id] || []).entries())
      results.push({
        type: "landmark", bodyId: body.id, siteIndex,
        name: site.name, site, path: [...path, site.name],
        parentPath: name, depth: ancestors.length + 1,
      });
    for (const child of children.get(body.id) || []) append(child, [...ancestors, body]);
  }
  for (const body of children.get(null) || []) append(body);
  for (const body of bodies) append(body);

  const cap = Math.max(1, limit);
  if (!needle) return results.filter((item) => item.type === "body").slice(0, cap);

  // A partial parent name is a request to browse that system, not merely a
  // flat text match. Keep one-letter queries compact to avoid huge results.
  const families = results.filter((item) =>
    item.type === "body" &&
    (matchScore(item.name, needle) === 0 ||
      (needle.length >= 2 && matchScore(item.name, needle) === 1)),
  );
  if (families.length) {
    const expanded = results.filter((item) => families.some((family) =>
      item.path.length >= family.path.length &&
      family.path.every((part, i) => item.path[i] === part),
    ));
    const remaining = results.filter((item) =>
      !expanded.includes(item) && matchScore(item.name, needle) < Infinity,
    );
    return [...expanded, ...remaining].slice(0, cap);
  }
  return results
    .map((item, index) => ({ item, index, score: matchScore(item.name, needle) }))
    .filter(({ score }) => score < Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, cap)
    .map(({ item }) => item);
}
