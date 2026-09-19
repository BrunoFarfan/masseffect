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
    latitude: Math.asin(clamp(v[1], -1, 1)) / DEG,
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

// Sample a global asset and, when present, blend a bounded regional DEM with a
// soft border. Regional coordinates never wrap in X: outside the declared
// rectangle the global map remains authoritative.
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
  const region = asset?.region;
  if (!region?.data || !region.uvBounds) return global;
  const [u0, v0, u1, v1] = region.uvBounds;
  if (!(u >= u0 && u <= u1 && v >= v0 && v <= v1) || !(u1 > u0 && v1 > v0))
    return global;
  const ru = (u - u0) / (u1 - u0),
    rv = (v - v0) / (v1 - v0);
  const regional = bilinearSampleClamped(
    region.data,
    region.width,
    region.height,
    ru,
    rv,
  );
  const border = Math.max(1e-9, region.blendBorder ?? 0.08);
  const edge = Math.min(ru, rv, 1 - ru, 1 - rv);
  const t = clamp(edge / border, 0, 1);
  const weight = t * t * (3 - 2 * t);
  return global * (1 - weight) + regional * weight;
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
