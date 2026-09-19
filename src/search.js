const normalize = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase();

export function rankSearch(query, bodies = [], landmarks = {}, limit = 12) {
  const needle = normalize(query);
  const results = [];
  for (let index = 0; index < bodies.length; index++) {
    const body = bodies[index];
    const name = String(body?.name || body?.id || "");
    results.push({ type: "body", id: body.id, name, body, index });
  }
  for (const [bodyId, sites] of Object.entries(landmarks || {})) {
    if (!bodies.some((body) => body.id === bodyId)) continue;
    for (let index = 0; index < (sites || []).length; index++) {
      const site = sites[index];
      results.push({
        type: "landmark",
        bodyId,
        siteIndex: index,
        name: site.name,
        site,
      });
    }
  }
  const score = (result) => {
    if (!needle)
      return [
        result.type === "body" ? 0 : 1,
        result.index ?? result.siteIndex,
        result.name,
      ];
    const name = normalize(result.name);
    const bodyName = normalize(result.body?.id);
    if (name === needle || bodyName === needle)
      return [0, result.type === "body" ? 0 : 1, result.name];
    if (name.startsWith(needle))
      return [1, result.type === "body" ? 0 : 1, result.name];
    if (name.split(/\s+/).some((word) => word.startsWith(needle)))
      return [2, result.type === "body" ? 0 : 1, result.name];
    if (name.includes(needle))
      return [3, result.type === "body" ? 0 : 1, result.name];
    return [4, result.type === "body" ? 0 : 1, result.name];
  };
  return results
    .filter((result) => !needle || score(result)[0] < 4)
    .sort((a, b) => {
      const as = score(a),
        bs = score(b);
      return as[0] - bs[0] || as[1] - bs[1] || as[2].localeCompare(bs[2]);
    })
    .slice(0, Math.max(1, limit));
}
