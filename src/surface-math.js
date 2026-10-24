import { clamp, unit } from "./math.js";

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export function wrapLongitude(longitude) {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

// Coordinates in the surface's [prime, north, east] frame. The simulation's
// ecliptic reflection is handled once by surfaceFrame, not again by the sampler.
export function localVectorFromLatLon(latitude, longitude) {
  const lat = clamp(latitude, -90, 90) * DEG;
  const lon = wrapLongitude(longitude) * DEG;
  const c = Math.cos(lat);
  return [c * Math.cos(lon), Math.sin(lat), c * Math.sin(lon)];
}

export function latLonFromLocalVector(vector) {
  const v = unit(vector);
  return {
    latitude: Math.atan2(v[1], Math.hypot(v[0], v[2])) / DEG,
    longitude: wrapLongitude(Math.atan2(v[2], v[0]) / DEG),
  };
}

export function uvFromLocalVector(vector) {
  const { latitude, longitude } = latLonFromLocalVector(vector);
  // u=.5 is the simplified prime meridian; increasing u is east-positive.
  return {
    u: (((longitude / 360 + 0.5) % 1) + 1) % 1,
    v: clamp(0.5 - latitude / 180, 0, 1),
  };
}

export function bilinearSample(source, width, height, u, v, channels = 1) {
  if (!source || width < 1 || height < 1 || channels < 1) return 0;
  const x = ((((u % 1) + 1) % 1) * width - 0.5 + width) % width;
  const y = clamp(v * height - 0.5, 0, height - 1);
  const x0 = Math.floor(x) % width;
  const x1 = (x0 + 1) % width;
  const y0 = clamp(Math.floor(y), 0, height - 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - Math.floor(x),
    fy = y - y0;
  const at = (ix, iy, channel) =>
    source[(iy * width + ix) * channels + channel] ?? 0;
  const values = [];
  for (let channel = 0; channel < channels; channel++)
    values.push(
      (at(x0, y0, channel) * (1 - fx) + at(x1, y0, channel) * fx) * (1 - fy) +
        (at(x0, y1, channel) * (1 - fx) + at(x1, y1, channel) * fx) * fy,
    );
  return channels === 1 ? values[0] : values;
}

function bilinearSampleClamped(source, width, height, u, v, channels = 1) {
  if (!source || width < 1 || height < 1) return 0;
  const x = clamp(u * width - 0.5, 0, width - 1),
    y = clamp(v * height - 0.5, 0, height - 1);
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    x1 = Math.min(width - 1, x0 + 1),
    y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0,
    fy = y - y0;
  const at = (ix, iy, channel) =>
    source[(iy * width + ix) * channels + channel] ?? 0;
  const values = [];
  for (let channel = 0; channel < channels; channel++)
    values.push(
      (at(x0, y0, channel) * (1 - fx) + at(x1, y0, channel) * fx) * (1 - fy) +
        (at(x0, y1, channel) * (1 - fx) + at(x1, y1, channel) * fx) * fy,
    );
  return channels === 1 ? values[0] : values;
}

// The same body-fixed projection is used by the GPU. Stereographic tiles
// cover a square around a cap; the opposite hemisphere is never eligible.
export function projectDetail(vector, descriptor) {
  if (descriptor.projection !== "polar-stereographic")
    return uvFromLocalVector(vector);
  const p = unit(vector),
    pole = descriptor.pole === -1 ? -1 : 1;
  if (pole * p[1] <= 0) return null;
  const scale = Math.tan(
    ((90 - (descriptor.capLatitude ?? 70)) * Math.PI) / 360,
  );
  const denominator = (1 + pole * p[1]) * scale;
  return {
    u: 0.5 + (0.5 * p[0]) / denominator,
    v: 0.5 - (0.5 * p[2]) / denominator,
  };
}

export function detailVector(u, v, descriptor) {
  if (descriptor.projection !== "polar-stereographic")
    return localVectorFromLatLon((0.5 - v) * 180, (u - 0.5) * 360);
  const scale = Math.tan(
    ((90 - (descriptor.capLatitude ?? 70)) * Math.PI) / 360,
  );
  const x = (u - 0.5) * 2 * scale,
    z = (0.5 - v) * 2 * scale;
  const r2 = x * x + z * z,
    pole = descriptor.pole === -1 ? -1 : 1;
  return [(2 * x) / (1 + r2), (pole * (1 - r2)) / (1 + r2), (2 * z) / (1 + r2)];
}

export function sameDetailProjection(a, b) {
  return (
    (a.projection || "equirectangular") ===
      (b.projection || "equirectangular") &&
    (a.pole || 0) === (b.pole || 0) &&
    (a.capLatitude ?? 70) === (b.capLatitude ?? 70)
  );
}

function adjacentDetail(a, b) {
  if (!sameDetailProjection(a, b)) return false;
  // A coarser fallback may overlap a curated DEM. It is not a neighboring
  // tile and must not erase that DEM's exposed-edge blend.
  const x =
    Math.min(a.uvBounds[2], b.uvBounds[2]) -
    Math.max(a.uvBounds[0], b.uvBounds[0]);
  const y =
    Math.min(a.uvBounds[3], b.uvBounds[3]) -
    Math.max(a.uvBounds[1], b.uvBounds[1]);
  return !(x > 1e-10 && y > 1e-10);
}

export function detailLayers(asset, kind = "region") {
  const layers = (asset?.detailTiles || [])
    .map((tile) => tile[kind])
    .filter((layer) => layer?.data);
  const fallback =
    kind === "region" ? asset?.fallbackRegion : asset?.fallbackColorRegion;
  if (fallback?.data) layers.unshift(fallback);
  if (asset?.[kind]?.data) {
    const legacy = asset[kind];
    return legacy.id?.startsWith("tile-")
      ? [legacy, ...layers.slice(0, 11)]
      : [...layers.slice(0, 11), legacy];
  }
  return layers.slice(0, 12);
}

// Resolve texels across loaded neighbors, including the global meridian. This
// also supplies the GPU atlas gutters, so interpolation has identical seams.
export function detailTexel(layers, layer, x, y, channels = 1) {
  let selected = layer;
  let sx = x,
    sy = y;
  if (x < 0 || y < 0 || x >= layer.width || y >= layer.height) {
    const [u0, v0, u1, v1] = layer.uvBounds;
    let u = u0 + ((x + 0.5) / layer.width) * (u1 - u0);
    const v = v0 + ((y + 0.5) / layer.height) * (v1 - v0);
    if (layer.projection !== "polar-stereographic") u = ((u % 1) + 1) % 1;
    const neighbor = layers.find(
      (other) =>
        other !== layer &&
        adjacentDetail(layer, other) &&
        u >= other.uvBounds[0] &&
        u < other.uvBounds[2] &&
        v >= other.uvBounds[1] &&
        v < other.uvBounds[3],
    );
    if (neighbor) {
      selected = neighbor;
      const [a, b, c, d] = neighbor.uvBounds;
      sx = Math.floor(((u - a) / (c - a)) * neighbor.width);
      sy = Math.floor(((v - b) / (d - b)) * neighbor.height);
    }
  }
  sx = clamp(sx, 0, selected.width - 1);
  sy = clamp(sy, 0, selected.height - 1);
  const neighborBlend = selected === layer ? 1 : (selected.detailBlend ?? 1);
  const ownX = clamp(x, 0, layer.width - 1),
    ownY = clamp(y, 0, layer.height - 1);
  return Array.from(
    { length: channels },
    (_, c) =>
      selected.data[(sy * selected.width + sx) * channels + c] * neighborBlend +
      layer.data[(ownY * layer.width + ownX) * channels + c] *
        (1 - neighborBlend),
  );
}

// Edges shared by resident tiles have full weight. Exposed edges retain a
// smooth global fallback while neighbors load; cap boundaries fade radially.
export function detailEdges(layer, layers) {
  const [a, b, c, d] = layer.uvBounds;
  const eps = 1e-8;
  const points = [
    [a - eps, (b + d) / 2],
    [(a + c) / 2, b - eps],
    [c + eps, (b + d) / 2],
    [(a + c) / 2, d + eps],
  ];
  return points.map(([u, v]) => {
    if (layer.projection !== "polar-stereographic") u = ((u % 1) + 1) % 1;
    const neighbor = layers.find(
      (other) =>
        other !== layer &&
        adjacentDetail(layer, other) &&
        u >= other.uvBounds[0] &&
        u <= other.uvBounds[2] &&
        v >= other.uvBounds[1] &&
        v <= other.uvBounds[3],
    );
    return neighbor ? 1 - (neighbor.detailBlend ?? 1) : 1;
  });
}

export function detailWeight(layer, layers, uv) {
  const [a, b, c, d] = layer.uvBounds;
  const ru = (uv.u - a) / (c - a),
    rv = (uv.v - b) / (d - b);
  if (ru < 0 || rv < 0 || ru > 1 || rv > 1) return 0;
  const edges = detailEdges(layer, layers),
    distances = [ru, rv, 1 - ru, 1 - rv];
  const smoothEdge = (edge) => {
    const t = clamp(edge / Math.max(layer.blendBorder ?? 0.025, 1e-9), 0, 1);
    return t * t * (3 - 2 * t);
  };
  let weight = 1;
  for (let i = 0; i < 4; i++)
    weight = Math.min(
      weight,
      1 - edges[i] + edges[i] * smoothEdge(distances[i]),
    );
  if (layer.projection === "polar-stereographic")
    weight = Math.min(
      weight,
      smoothEdge(
        (0.5 - Math.hypot(uv.u - 0.5, uv.v - 0.5)) / Math.max(c - a, d - b),
      ),
    );
  return weight * (layer.detailBlend ?? 1);
}

export function sampleDetail(layers, layer, uv, channels = 1) {
  const [a, b, c, d] = layer.uvBounds;
  const x = ((uv.u - a) / (c - a)) * layer.width - 0.5,
    y = ((uv.v - b) / (d - b)) * layer.height - 0.5;
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const q = [
    detailTexel(layers, layer, ix, iy, channels),
    detailTexel(layers, layer, ix + 1, iy, channels),
    detailTexel(layers, layer, ix, iy + 1, channels),
    detailTexel(layers, layer, ix + 1, iy + 1, channels),
  ];
  const values = q[0].map(
    (_, i) =>
      (q[0][i] * (1 - fx) + q[1][i] * fx) * (1 - fy) +
      (q[2][i] * (1 - fx) + q[3][i] * fx) * fy,
  );
  return channels === 1 ? values[0] : values;
}

export function sampleAssetHeight(asset, u, v) {
  const global = asset?.height
    ? bilinearSample(
        asset.height.data,
        asset.height.width,
        asset.height.height,
        u,
        v,
      )
    : 0;
  const layers = detailLayers(asset);
  const vector = localVectorFromLatLon((0.5 - v) * 180, (u - 0.5) * 360);
  // Last layer is the curated regional DEM, whose resolution can exceed the pack.
  let result = global;
  for (const layer of layers) {
    const uv = projectDetail(vector, layer);
    if (!uv) continue;
    const weight = detailWeight(layer, layers, uv);
    if (weight)
      result = result * (1 - weight) + sampleDetail(layers, layer, uv) * weight;
  }
  return result;
}

// A longitude has no meaning at a pole. Collapse the outermost global pixel
// rows once during decode; both CPU and GPU then converge to the same value.
export function stabilizeGlobalPoles(resource, channels = 1) {
  if (!resource?.data || resource.height < 2) return resource;
  for (const row of [0, resource.height - 1])
    for (let c = 0; c < channels; c++) {
      let sum = 0;
      for (let x = 0; x < resource.width; x++)
        sum += resource.data[(row * resource.width + x) * channels + c];
      const mean = sum / resource.width;
      for (let x = 0; x < resource.width; x++)
        resource.data[(row * resource.width + x) * channels + c] = mean;
    }
  return resource;
}

export function decodeHeightUnsigned16LE(
  bytes,
  index,
  offsetMeters = 0,
  scaleMeters = 1,
) {
  const i = index * 2;
  const value =
    bytes instanceof DataView
      ? bytes.getUint16(i, true)
      : bytes[i] | (bytes[i + 1] << 8);
  return offsetMeters + value * scaleMeters;
}

export function sampleHeightUnsigned16LE(
  bytes,
  width,
  height,
  u,
  v,
  offsetMeters = 0,
  scaleMeters = 1,
) {
  const x = ((((u % 1) + 1) % 1) * width - 0.5 + width) % width;
  const y = clamp(v * height - 0.5, 0, height - 1);
  const x0 = Math.floor(x) % width,
    x1 = (x0 + 1) % width;
  const y0 = clamp(Math.floor(y), 0, height - 1),
    y1 = Math.min(height - 1, y0 + 1);
  const fx = x - Math.floor(x),
    fy = y - y0;
  const at = (ix, iy) =>
    decodeHeightUnsigned16LE(bytes, iy * width + ix, offsetMeters, scaleMeters);
  return (
    (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) +
    (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
  );
}

export function ellipsoidDirectionalRadius(direction, radii) {
  const d = unit(direction);
  const a = radii[0] ?? radii.x,
    b = radii[1] ?? radii.y,
    c = radii[2] ?? radii.z;
  return (
    1 /
    Math.sqrt(
      (d[0] * d[0]) / (a * a) +
        (d[1] * d[1]) / (b * b) +
        (d[2] * d[2]) / (c * c),
    )
  );
}

export { TAU };
