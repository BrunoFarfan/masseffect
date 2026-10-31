import { detailLayers, detailTexel, detailEdges } from "./surface-math.js";
import { sphereRasterBounds } from "./sphere.js";

// A small, deliberately self-contained WebGL2 terrain pass. The public
// surfaceState shape is:
// { frame: { prime, north, east }, asset: {
//     color: { width, height, data: Uint8ClampedArray (RGBA) },
//     height?: { width, height, data: Float32Array (meters) }
//   }, referenceRadiusMeters, exaggeration?, minElevationMeters?,
//   maxElevationMeters?, transition?: number }
// `frame` axes are world-unit vectors. Maps use u=atan2(east,prime) and
// v=.5-atan(north,length(prime,east))/PI; texture row zero is north. GPU positions are divided
// by referenceRadiusMeters, while all physics and CPU inputs remain meters.

const VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT_TEMPLATE = `#version 300 es
precision highp float;
precision highp int;
uniform vec2 uSize;
uniform float uFocal, uOffsetX, uRadius, uPhysicalRadius, uExaggeration, uHeightScale, uDisplacement, uBlend, uHasPreviousHeight;
uniform float uMicroDetail, uMaxRayIterations, uDisplayExposure, uCellStep, uNormalStep;
uniform float uAtmosphericBands;
uniform vec3 uOrigin, uDirection, uRight, uUp;
uniform vec3 uLight;
uniform vec3 uBaseAxes;
uniform float uWater, uEmissive;
uniform float uEllipsoidC;
uniform vec3 uAtmosphereColor;
uniform float uAtmosphereOpacity;
uniform float uMinHeight, uMaxHeight, uHasHeight, uOpacity;
uniform sampler2D uColor;
uniform sampler2D uColorPrev;
uniform sampler2D uColorRegion;
uniform sampler2D uPreviousColorRegion;
uniform vec4 uColorRegionBounds, uPreviousColorRegionBounds;
uniform float uHasColorRegion, uHasPreviousColorRegion, uColorRegionBlendBorder;
uniform sampler2D uHeight;
uniform sampler2D uHeightPrev;
uniform sampler2D uRegion;
uniform sampler2D uPreviousRegion;
uniform ivec2 uHeightSize;
uniform ivec2 uPreviousHeightSize;
uniform ivec2 uRegionSize;
uniform ivec2 uPreviousRegionSize;
uniform vec4 uRegionBounds, uPreviousRegionBounds;
uniform float uHasRegion, uHasPreviousRegion, uRegionBlendBorder;
uniform int uCurrentHeightCount;
uniform vec4 uCurrentHeightBounds[12], uCurrentHeightCells[12], uCurrentHeightParams[12], uCurrentHeightEdges[12];
uniform int uPreviousHeightCount;
uniform vec4 uPreviousHeightBounds[12], uPreviousHeightCells[12], uPreviousHeightParams[12], uPreviousHeightEdges[12];
uniform int uCurrentColorCount;
uniform vec4 uCurrentColorBounds[12], uCurrentColorCells[12], uCurrentColorParams[12], uCurrentColorEdges[12];
uniform int uPreviousColorCount;
uniform vec4 uPreviousColorBounds[12], uPreviousColorCells[12], uPreviousColorParams[12], uPreviousColorEdges[12];
out vec4 outColor;

float wrap01(float x) { return x - floor(x); }
vec2 mapUv(vec3 p) {
  p = normalize(p);
  return vec2(wrap01((atan(p.z, p.x) + 3.14159265359) / 6.28318530718),
             clamp(0.5 - atan(p.y, length(p.xz)) / 3.14159265359, 0.0, 1.0));
}
float hAt(sampler2D tex, ivec2 q, ivec2 size) {
  q.x = (q.x % size.x + size.x) % size.x;
  q.y = clamp(q.y, 0, size.y - 1);
  return texelFetch(tex, q, 0).r;
}
float heightAtOne(sampler2D tex, ivec2 size, vec2 uv) {
  vec2 xy = vec2(wrap01(uv.x) * float(size.x) - 0.5, clamp(uv.y, 0.0, 1.0) * float(size.y) - 0.5);
  ivec2 q = ivec2(floor(xy)); vec2 f = fract(xy);
  float a = mix(hAt(tex, q, size), hAt(tex, q + ivec2(1, 0), size), f.x);
  float b = mix(hAt(tex, q + ivec2(0, 1), size), hAt(tex, q + ivec2(1, 1), size), f.x);
  return mix(a, b, f.y);
}
float heightAtRegion(sampler2D tex, ivec2 size, vec2 uv, vec4 bounds) {
  vec2 ru = clamp((uv - bounds.xy) / max(bounds.zw - bounds.xy, vec2(0.000001)), 0.0, 1.0);
  vec2 xy = ru * vec2(size) - 0.5;
  ivec2 q = ivec2(floor(xy)); vec2 f = fract(xy);
  float a = texelFetch(tex, ivec2(clamp(q.x, 0, size.x - 1), clamp(q.y, 0, size.y - 1)), 0).r;
  float b = texelFetch(tex, ivec2(clamp(q.x + 1, 0, size.x - 1), clamp(q.y, 0, size.y - 1)), 0).r;
  float c = texelFetch(tex, ivec2(clamp(q.x, 0, size.x - 1), clamp(q.y + 1, 0, size.y - 1)), 0).r;
  float d = texelFetch(tex, ivec2(clamp(q.x + 1, 0, size.x - 1), clamp(q.y + 1, 0, size.y - 1)), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float regionalWeight(vec2 uv, vec4 bounds) {
  vec2 ru = (uv - bounds.xy) / max(bounds.zw - bounds.xy, vec2(0.000001));
  float edge = min(min(ru.x, ru.y), min(1.0 - ru.x, 1.0 - ru.y));
  return smoothstep(0.0, max(uRegionBlendBorder, 0.000001), edge);
}
vec4 detailValue(sampler2D tex, vec3 p, int count,
  vec4 bounds[12], vec4 cells[12], vec4 params[12], vec4 edges[12]) {
  p=normalize(p);
  vec3 value=vec3(0.0);
  float remaining=1.0;
  vec2 uv=vec2(-2.0);
  // Front-to-back composition stops at an opaque tile. Pack ordering puts
  // the center-ray tile first in this reverse traversal; curated DEMs retain
  // priority above the pack and its legacy fallback.
  for(int offset=0;offset<12;offset++) {
    if(offset>=count) break;
    int i=count-1-offset;
    vec2 projected;
    if(abs(params[i].x)>.5) {
      if(params[i].x*p.y<=0.0) continue;
      float denominator=(1.0+params[i].x*p.y)*params[i].y;
      projected=vec2(.5+.5*p.x/denominator,.5-.5*p.z/denominator);
    } else {
      if(uv.x < -1.0) uv=mapUv(p);
      projected=uv;
    }
    vec2 local=(projected-bounds[i].xy)/(bounds[i].zw-bounds[i].xy);
    if(any(lessThan(local,vec2(0.0))) || any(greaterThan(local,vec2(1.0)))) continue;
    vec4 distances=vec4(local,1.0-local);
    float border=max(params[i].z,.000000001),weight=1.0;
    for(int j=0;j<4;j++) weight=min(weight,mix(1.0,smoothstep(0.0,border,distances[j]),edges[i][j]));
    if(abs(params[i].x)>.5) weight=min(weight,smoothstep(0.0,border,(.5-length(projected-vec2(.5)))/max(bounds[i].z-bounds[i].x,bounds[i].w-bounds[i].y)));
    weight*=params[i].w;
    if(weight<=0.0) continue;
    vec2 xy=cells[i].xy+local*cells[i].zw-.5;
    ivec2 q=ivec2(floor(xy)); vec2 f=fract(xy);
    vec4 a=mix(texelFetch(tex,q,0),texelFetch(tex,q+ivec2(1,0),0),f.x);
    vec4 b=mix(texelFetch(tex,q+ivec2(0,1),0),texelFetch(tex,q+ivec2(1,1),0),f.x);
    value+=remaining*weight*mix(a,b,f.y).rgb;
    remaining*=1.0-weight;
    if(remaining<=0.0) return vec4(value,1.0);
  }
  return vec4(value,1.0-remaining);
}
vec3 currentColor(vec3 p) {
  vec4 detail=detailValue(uColorRegion,p,uCurrentColorCount,uCurrentColorBounds,uCurrentColorCells,uCurrentColorParams,uCurrentColorEdges);
  if(detail.a>=1.0) return detail.rgb;
  return detail.rgb+(1.0-detail.a)*texture(uColor,mapUv(p)).rgb;
}
vec3 previousColor(vec3 p) {
  vec4 detail=detailValue(uPreviousColorRegion,p,uPreviousColorCount,uPreviousColorBounds,uPreviousColorCells,uPreviousColorParams,uPreviousColorEdges);
  if(detail.a>=1.0) return detail.rgb;
  return detail.rgb+(1.0-detail.a)*texture(uColorPrev,mapUv(p)).rgb;
}
float heightAtRaw(vec3 p) {
  if(uHasHeight<.5) return 0.0;
  vec4 detail=detailValue(uRegion,p,uCurrentHeightCount,uCurrentHeightBounds,uCurrentHeightCells,uCurrentHeightParams,uCurrentHeightEdges);
  float current=detail.r;
  if(detail.a<1.0) current+=(1.0-detail.a)*heightAtOne(uHeight,uHeightSize,mapUv(p));
  if(uBlend>=.999999) return current*uHeightScale;
  float previous=0.0;
  if(uHasPreviousHeight>.5) {
    vec4 old=detailValue(uPreviousRegion,p,uPreviousHeightCount,uPreviousHeightBounds,uPreviousHeightCells,uPreviousHeightParams,uPreviousHeightEdges);
    previous=old.r;
    if(old.a<1.0) previous+=(1.0-old.a)*heightAtOne(uHeightPrev,uPreviousHeightSize,mapUv(p));
  }
  return mix(previous,current,uBlend)*uHeightScale;
}
float baseHeight(vec3 p) {
  if(all(equal(uBaseAxes,vec3(1.0)))) return 0.0;
  return 1.0/length(normalize(p)/uBaseAxes)-uRadius;
}
float visualHeight(vec3 p) {
  float base=baseHeight(p);
  if(uHasHeight<.5) return base;
  float relief=(heightAtRaw(p)-base)*uExaggeration;
  return base+(uWater>.5?max(0.0,relief):relief);
}
float heightAt(vec3 p) {
  float base=baseHeight(p);
  return base+(visualHeight(p)-base)*uDisplacement;
}
float gap(vec3 p) {
  return length(p) - (uRadius + heightAt(p));
}
vec3 topoNormal(vec3 p, float radius) {
  vec3 radial=normalize(p);
  if(uHasHeight<.5) return normalize(p/(uBaseAxes*uBaseAxes));
  // Differentiate in an orthonormal tangent plane, never in longitude. The
  // longitude metric vanishes at a pole and its texture derivative is singular.
  vec3 tangent=normalize(cross(abs(radial.y)<.9?vec3(0,1,0):vec3(1,0,0),radial));
  vec3 bitangent=normalize(cross(radial,tangent));
  float stepAngle=uNormalStep;
  float dx=(visualHeight(radial+tangent*stepAngle)-visualHeight(radial-tangent*stepAngle))/(2.0*radius*stepAngle);
  float dy=(visualHeight(radial+bitangent*stepAngle)-visualHeight(radial-bitangent*stepAngle))/(2.0*radius*stepAngle);
  return normalize(radial-tangent*dx-bitangent*dy);
}
float hash31(vec3 p) {
  p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i), n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0)), n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0)), n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0)), n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float pixelFootprint(vec3 p) {
  return max(length(dFdx(p)), length(dFdy(p))) * uPhysicalRadius;
}
float microField(vec3 p, float footprint) {
  vec3 q = p * uPhysicalRadius;
  return (noise3(q / 160.0) - .5) * .55 * (1.0-smoothstep(40.0,80.0,footprint))
    + (noise3(q / 24.0 + 17.0) - .5) * .30 * (1.0-smoothstep(6.0,12.0,footprint))
    + (noise3(q / 4.0 + 43.0) - .5) * .15 * (1.0-smoothstep(1.0,2.0,footprint));
}
float microFade(vec3 p) {
  if (uHasHeight < 0.5) return 0.0;
  float pixelMeters = pixelFootprint(p);
  if (pixelMeters >= 80.0) return 0.0;
  float demMeters = min(6.2831853 * uPhysicalRadius / max(float(uHeightSize.x), 1.0), 3.14159265 * uPhysicalRadius / max(float(uHeightSize.y), 1.0));
  return uMicroDetail * (1.0 - smoothstep(demMeters * 1.0, demMeters * 5.0, pixelMeters));
}
vec3 detailedNormal(vec3 p, vec3 baseNormal) {
  float fade = microFade(p);
  if (fade <= 0.001) return baseNormal;
  vec3 radial = normalize(p);
  vec3 east = length(radial.xz) > 0.00001 ? normalize(vec3(-radial.z, 0.0, radial.x)) : vec3(0.0, 0.0, 1.0);
  vec3 north = normalize(cross(east, radial));
  float footprint = pixelFootprint(p);
  float stepMeters = max(0.75, footprint * 0.5);
  vec3 ds = east * (stepMeters / uPhysicalRadius), dt = north * (stepMeters / uPhysicalRadius);
  float gx = (microField(p + ds, footprint) - microField(p - ds, footprint)) / (2.0 * stepMeters);
  float gy = (microField(p + dt, footprint) - microField(p - dt, footprint)) / (2.0 * stepMeters);
  return normalize(baseNormal - fade * 6.0 * (east * gx + north * gy));
}
void main() {
  vec2 xy = (gl_FragCoord.xy - vec2(uSize.x * 0.5 + uOffsetX, uSize.y * 0.5));
  vec3 ray = normalize(uDirection + uRight * (xy.x / uFocal) + uUp * (xy.y / uFocal));
  float outer = max(max(uBaseAxes.x,uBaseAxes.y),uBaseAxes.z) + max(abs(uMinHeight), abs(uMaxHeight)) * uExaggeration * uDisplacement;
  bool found = uHasHeight < 0.5 || uDisplacement < 0.00001;
  float t=0.0, end=0.0, hit=0.0;
  if(found) {
    vec3 eo=uOrigin/uBaseAxes, er=ray/uBaseAxes;
    float ea=dot(er,er), eb=dot(eo,er), ec=uEllipsoidC;
    float ed=eb*eb-ea*ec;
    if(ed<=0.0 || eb>=0.0) discard;
    // Rational near root avoids subtracting almost equal terms at meter
    // clearance over a 695,700 km photosphere. CPU computes c in double precision.
    hit=ec/(-eb+sqrt(ed));
    if(hit<0.0) discard;
  } else {
    float b = dot(uOrigin, ray), c = (length(uOrigin)-outer)*(length(uOrigin)+outer);
    float disc = b*b-c;
    if(disc<=0.0) discard;
    t=max(0.0,-b-sqrt(disc)); end=-b+sqrt(disc);
    if(end<t) discard;
  }
  // Refine only inside the analytic outer shell. A small footprint tolerance
  // terminates tangential rays without pretending subpixel DEM detail exists.
  for (int i = 0; i < 256; i++) {
    if (found || t > end || float(i) >= uMaxRayIterations) break;
    float g = gap(uOrigin + ray * t);
    float tolerance = max(0.15 * uHeightScale, t / uFocal * 0.18);
    if (g <= tolerance) { hit = t; found = true; break; }
    float next = min(end, t + max(uCellStep, g / 2.0));
    if (next <= t) break;
    if (gap(uOrigin + ray * next) <= 0.0) {
      float lo = t, hi = next;
      for (int j = 0; j < 12; j++) {
        float mid = (lo + hi) * 0.5;
        if (gap(uOrigin + ray * mid) > 0.0) lo = mid; else hi = mid;
      }
      hit = hi; found = true; break;
    }
    t = next;
  }
  if (!found) discard;
  vec3 point = uOrigin + ray * hit;
  vec3 normal = detailedNormal(point, topoNormal(point, uRadius));
  float diffuse = max(0.0, dot(normal, normalize(uLight - point)));
  float shade = uEmissive>.5 ? 1.0 : 0.12 + 0.88 * diffuse;
  vec2 colorUv = mapUv(point);
  vec3 srgb=currentColor(point);
  if(uBlend<.999999) srgb=mix(previousColor(point),srgb,uBlend);
  // Uranus has no solid terrain. This restrained, deterministic banding is
  // an atmospheric appearance layer applied only to products that opt in;
  // it never participates in height, clearance, or ray intersection.
  if (uAtmosphericBands > 0.5) {
    // JPL's representative map is nearly uniform saturated blue. Voyager's
    // true-color disk is paler and greener, with very low cloud contrast.
    srgb = mix(srgb, vec3(0.55, 0.79, 0.80), 0.75);
    // Body-fixed Cartesian coordinates are continuous across the texture
    // meridian; raw longitude UV would leave a visible cloud seam.
    vec3 cloudPosition = normalize(point);
    float band = sin((colorUv.y - 0.5) * 78.0 + noise3(cloudPosition * 9.0) * 1.8);
    float turbulence = noise3(cloudPosition * vec3(10.0, 32.0, 10.0) + vec3(0.0, 0.0, 19.0)) - 0.5;
    srgb *= 1.0 + 0.055 * band + 0.025 * turbulence;
  }
  // Explicit illustrative haze layer: reveals the independently sampled DEM
  // below cloud altitude. Cloud brightness is never used as terrain height.
  vec3 cloud = uAtmosphereColor * (0.94 + 0.08 * noise3(normalize(point) * 12.0));
  srgb = mix(srgb, cloud, uAtmosphereOpacity);
  vec3 color = pow(max(srgb, vec3(0.0)), vec3(2.2));
  float detail = microFade(point);
  if (detail > 0.0) color *= 1.0 + detail * (microField(point, pixelFootprint(point)) * 0.65);
  color = pow(max(color * shade * uDisplayExposure, vec3(0.0)), vec3(1.0 / 2.2));
  outColor = vec4(color, uOpacity);
}`;

// Uniform arrays must stay in constant storage. Passing all four arrays as
// GLSL function arguments can make ANGLE copy them into thread-local arrays
// for every ray sample. Specialize the shared implementation at build time.
function specializeDetailShader(source) {
  const start=source.indexOf("vec4 detailValue(");
  const end=source.indexOf("vec3 currentColor(",start);
  const template=source.slice(start,end);
  let implementations="";
  for(const [prefix,texture] of [["CurrentHeight","uRegion"],["PreviousHeight","uPreviousRegion"],["CurrentColor","uColorRegion"],["PreviousColor","uPreviousColorRegion"]]) {
    let implementation=template.replace(/vec4 detailValue\([\s\S]*?\) \{/,`vec4 detail${prefix}(vec3 p) {`);
    for(const [word,replacement] of [["tex",texture],["count",`u${prefix}Count`],["bounds",`u${prefix}Bounds`],["cells",`u${prefix}Cells`],["params",`u${prefix}Params`],["edges",`u${prefix}Edges`]])
      implementation=implementation.replace(new RegExp(`\\b${word}\\b`,"g"),replacement);
    implementations+=implementation;
    source=source.replaceAll(`detailValue(${texture},p,u${prefix}Count,u${prefix}Bounds,u${prefix}Cells,u${prefix}Params,u${prefix}Edges)`,`detail${prefix}(p)`);
  }
  return source.slice(0,start)+implementations+source.slice(end);
}

const FRAGMENT=specializeDetailShader(FRAGMENT_TEMPLATE);

export function buildDetailAtlas(asset, kind = "region", metadataOnly = false) {
  const layers = detailLayers(asset, kind),
    channels = kind === "colorRegion" ? 4 : 1;
  if (!layers.length) return null;
  // Shelf packing avoids padding every 512px tile to a curated 1024px DEM.
  const width = Math.max(
    ...layers.map((layer) => layer.width + 2),
    Math.min(
      2056,
      layers.reduce((sum, layer) => sum + layer.width + 2, 0),
    ),
  );
  const positions = [];
  let cursorX = 0,
    cursorY = 0,
    rowHeight = 0;
  for (const layer of layers) {
    if (cursorX + layer.width + 2 > width) {
      cursorY += rowHeight;
      cursorX = 0;
      rowHeight = 0;
    }
    positions.push([cursorX + 1, cursorY + 1]);
    cursorX += layer.width + 2;
    rowHeight = Math.max(rowHeight, layer.height + 2);
  }
  const height = cursorY + rowHeight;
  const data = metadataOnly
    ? null
    : channels === 4
      ? new Uint8Array(width * height * 4)
      : new Float32Array(width * height);
  const bounds = new Float32Array(48),
    cells = new Float32Array(48),
    params = new Float32Array(48),
    edges = new Float32Array(48);
  layers.forEach((layer, i) => {
    const [ox, oy] = positions[i];
    bounds.set(layer.uvBounds, i * 4);
    cells.set([ox, oy, layer.width, layer.height], i * 4);
    params.set(
      [
        layer.projection === "polar-stereographic"
          ? layer.pole === -1
            ? -1
            : 1
          : 0,
        Math.tan(((90 - (layer.capLatitude ?? 70)) * Math.PI) / 360),
        layer.blendBorder ?? 0.025,
        layer.detailBlend ?? 1,
      ],
      i * 4,
    );
    edges.set(detailEdges(layer, layers), i * 4);
    if (data)
      for (let y = -1; y <= layer.height; y++)
        for (let x = -1; x <= layer.width; x++) {
          const value = detailTexel(layers, layer, x, y, channels);
          const offset = ((oy + y) * width + ox + x) * channels;
          for (let c = 0; c < channels; c++) data[offset + c] = value[c];
        }
  });
  return {
    data,
    width,
    height,
    count: layers.length,
    bounds,
    cells,
    params,
    edges,
    layers,
    channels,
  };
}

function shaderError(gl, shader, label) {
  const log = gl.getShaderInfoLog(shader) || "";
  return `${label} shader: ${log}`.trim();
}

export class TerrainGPU {
  constructor({ canvas = null, maxTextures = 8, quality = {} } = {}) {
    this.canvas =
      canvas ||
      (typeof document !== "undefined"
        ? document.createElement("canvas")
        : null);
    this.maxTextures = Math.max(1, maxTextures);
    this.quality = { maxRayIterations: 256, resolutionScale: 1, ...quality };
    this.cache = new Map();
    this.atlases = new WeakMap();
    this.budgetBytes = 128 * 1024 * 1024;
    this.error = null;
    this.lost = false;
    this.frame = 0;
    this.gl = null;
    if (!this.canvas?.getContext) return;
    try {
      this.gl = this.canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        preserveDrawingBuffer: true,
      });
    } catch (error) {
      this.error = String(error);
    }
    if (!this.gl) return;
    this._onLost = (event) => {
      event.preventDefault();
      this.lost = true;
    };
    this._onRestored = () => {
      this.lost = false;
      this.error = null;
      this._build();
    };
    this.canvas.addEventListener?.("webglcontextlost", this._onLost, false);
    this.canvas.addEventListener?.(
      "webglcontextrestored",
      this._onRestored,
      false,
    );
    this._build();
  }

  _build() {
    const gl = this.gl;
    if (!gl) return;
    const compile = (type, source, label) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(shaderError(gl, shader, label));
      return shader;
    };
    try {
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX, "vertex"));
      gl.attachShader(
        program,
        compile(gl.FRAGMENT_SHADER, FRAGMENT, "fragment"),
      );
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(
          `program: ${gl.getProgramInfoLog(program) || "link failed"}`,
        );
      this.program = program;
      const names = [
        "uSize",
        "uFocal",
        "uOffsetX",
        "uRadius",
        "uPhysicalRadius",
        "uExaggeration",
        "uHeightScale",
        "uDisplacement",
        "uBlend",
        "uMicroDetail",
        "uDisplayExposure",
        "uBaseAxes",
        "uWater",
        "uEmissive",
        "uEllipsoidC",
        "uAtmosphereColor",
        "uAtmosphereOpacity",
        "uAtmosphericBands",
        "uMaxRayIterations",
        "uCellStep",
        "uNormalStep",
        "uOrigin",
        "uDirection",
        "uRight",
        "uUp",
        "uLight",
        "uMinHeight",
        "uMaxHeight",
        "uHasHeight",
        "uHasPreviousHeight",
        "uOpacity",
        "uColor",
        "uColorPrev",
        "uColorRegion",
        "uPreviousColorRegion",
        "uColorRegionBounds",
        "uPreviousColorRegionBounds",
        "uHasColorRegion",
        "uHasPreviousColorRegion",
        "uColorRegionBlendBorder",
        "uHeight",
        "uHeightPrev",
        "uRegion",
        "uPreviousRegion",
        "uHeightSize",
        "uPreviousHeightSize",
        "uRegionSize",
        "uPreviousRegionSize",
        "uRegionBounds",
        "uPreviousRegionBounds",
        "uHasRegion",
        "uHasPreviousRegion",
        "uRegionBlendBorder",
      ];
      for (const prefix of [
        "CurrentHeight",
        "PreviousHeight",
        "CurrentColor",
        "PreviousColor",
      ]) {
        names.push(`u${prefix}Count`);
        for (const field of ["Bounds", "Cells", "Params", "Edges"])
          names.push(`u${prefix}${field}`);
      }
      this.uniforms = Object.fromEntries(
        names.map((name) => [name, gl.getUniformLocation(program, name)]),
      );
      this.vao = gl.createVertexArray();
      for (const item of this.cache.values()) {
        for (const texture of Object.values(item.gpu || {}))
          if (texture?.texture) gl.deleteTexture(texture.texture);
        item.gpu = null;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.program = null;
    }
  }

  _prepareEntry(bodyId, sources) {
    const entry = this.cache.get(bodyId) || { gpu: {}, lastUsed: 0 };
    // Global maps are large and unchanged when another small tile arrives.
    // Keep their texture objects; release only replaced or unused slots.
    for (const [kind, uploaded] of Object.entries(entry.gpu || {}))
      if (uploaded && uploaded.source !== sources[kind]) {
        this.gl.deleteTexture(uploaded.texture);
        delete entry.gpu[kind];
      }
    Object.assign(entry, sources);
    this.cache.set(bodyId, entry);
    return entry;
  }

  _refreshAtlasGutters(texture, atlas) {
    const gl = this.gl,
      color = atlas.channels === 4,
      channels = atlas.channels;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    atlas.layers.forEach((layer, i) => {
      const ox = atlas.cells[i * 4],
        oy = atlas.cells[i * 4 + 1];
      const strip = (x, y, w, h) => {
        const pixels = color
          ? new Uint8Array(w * h * channels)
          : new Float32Array(w * h);
        for (let row = 0; row < h; row++)
          for (let col = 0; col < w; col++) {
            const value = detailTexel(
              atlas.layers,
              layer,
              x + col,
              y + row,
              channels,
            );
            for (let c = 0; c < channels; c++)
              pixels[(row * w + col) * channels + c] = value[c];
          }
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          ox + x,
          oy + y,
          w,
          h,
          color ? gl.RGBA : gl.RED,
          color ? gl.UNSIGNED_BYTE : gl.FLOAT,
          pixels,
        );
      };
      strip(-1, -1, layer.width + 2, 1);
      strip(-1, layer.height, layer.width + 2, 1);
      strip(-1, 0, 1, layer.height);
      strip(layer.width, 0, 1, layer.height);
    });
  }

  _texture(entry, kind, source) {
    const gl = this.gl;
    if ((!source?.data && !source?.layers) || !source.width || !source.height)
      return null;
    entry.gpu ||= {};
    if (entry.gpu[kind]?.source === source) {
      const uploaded = entry.gpu[kind];
      if (
        source.layers &&
        (uploaded.fading ||
          source.layers.some((layer) => (layer.detailBlend ?? 1) < 1))
      ) {
        this._refreshAtlasGutters(uploaded.texture, source);
        uploaded.fading = source.layers.some(
          (layer) => (layer.detailBlend ?? 1) < 1,
        );
      }
      return uploaded.texture;
    }
    if (entry.gpu[kind]) gl.deleteTexture(entry.gpu[kind].texture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    if (source.layers) {
      // Allocate only GPU atlas storage. Upload one tile and its shared-edge
      // gutter at a time; never retain another decoded copy of the CPU pack.
      const color = source.channels === 4;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        color ? gl.RGBA8 : gl.R32F,
        source.width,
        source.height,
        0,
        color ? gl.RGBA : gl.RED,
        color ? gl.UNSIGNED_BYTE : gl.FLOAT,
        null,
      );
      source.layers.forEach((layer, i) => {
        const w = layer.width + 2,
          h = layer.height + 2,
          channels = source.channels;
        const staging = color
          ? new Uint8Array(w * h * channels)
          : new Float32Array(w * h);
        for (let y = 0; y < layer.height; y++) {
          const start = y * layer.width * channels;
          staging.set(
            layer.data.subarray(start, start + layer.width * channels),
            ((y + 1) * w + 1) * channels,
          );
        }
        const put = (x, y) => {
          const value = detailTexel(source.layers, layer, x, y, channels),
            offset = ((y + 1) * w + x + 1) * channels;
          for (let c = 0; c < channels; c++) staging[offset + c] = value[c];
        };
        for (let x = -1; x <= layer.width; x++) {
          put(x, -1);
          put(x, layer.height);
        }
        for (let y = 0; y < layer.height; y++) {
          put(-1, y);
          put(layer.width, y);
        }
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          source.cells[i * 4] - 1,
          source.cells[i * 4 + 1] - 1,
          w,
          h,
          color ? gl.RGBA : gl.RED,
          color ? gl.UNSIGNED_BYTE : gl.FLOAT,
          staging,
        );
      });
    } else if (
      ["color", "previousColor", "colorRegion", "previousColorRegion"].includes(
        kind,
      )
    ) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(
        gl.TEXTURE_2D,
        gl.TEXTURE_WRAP_S,
        kind === "color" || kind === "previousColor"
          ? gl.REPEAT
          : gl.CLAMP_TO_EDGE,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        source.width,
        source.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source.data,
      );
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        source.width,
        source.height,
        0,
        gl.RED,
        gl.FLOAT,
        source.data,
      );
    }
    entry.gpu[kind] = {
      texture,
      source,
      width: source.width,
      height: source.height,
      fading:
        source.layers?.some((layer) => (layer.detailBlend ?? 1) < 1) || false,
    };
    return texture;
  }

  draw(ctx, body, camera, width, height, light, surfaceState) {
    const gl = this.gl,
      state = surfaceState;
    if (
      !gl ||
      this.lost ||
      !this.program ||
      !ctx ||
      !body ||
      !camera ||
      !state?.asset?.color ||
      !state.frame
    )
      return false;
    const radius = Number(state.referenceRadiusMeters || body.radius);
    if (!(radius > 0)) return false;
    const atlases = (asset) => {
      if (!this.atlases.has(asset))
        this.atlases.set(asset, {
          height: buildDetailAtlas(asset, "region", true),
          color: buildDetailAtlas(asset, "colorRegion", true),
        });
      return this.atlases.get(asset);
    };
    const currentAtlas = atlases(state.asset);
    const color = state.asset.color,
      heightMap = state.asset.height,
      region = currentAtlas.height,
      colorRegion = currentAtlas.color;
    const previous = state.previousAsset || state.asset;
    const previousAtlas = atlases(previous);
    const previousColor = previous?.color || color,
      previousHeight = previous?.height || null,
      previousRegion = previousAtlas.height,
      previousColorRegion = previousAtlas.color;
    if (!(color.data && color.width > 0 && color.height > 0)) return false;
    const displayW = Math.max(1, Math.floor(width)),
      displayH = Math.max(1, Math.floor(height));
    const quality = { ...this.quality, ...(state.quality || {}) };
    const scale = Math.max(
      0.25,
      Math.min(1, Number(quality.resolutionScale) || 1),
    );
    const w = Math.max(1, Math.floor(displayW * scale)),
      h = Math.max(1, Math.floor(displayH * scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const frame = state.frame,
      axes = [frame.prime, frame.north, frame.east];
    if (axes.some((a) => !a || a.length !== 3)) return false;
    const rel = body.position.map((v, i) => camera.position[i] - v);
    const project = (v) =>
      axes.map((a) => a[0] * v[0] + a[1] * v[1] + a[2] * v[2]);
    const origin = project(rel).map((v) => v / radius);
    const direction = project(camera.forward),
      right = project(camera.right),
      up = project(camera.up);
    const focal = displayH * 0.95,
      rasterFocal = focal * scale,
      offset = ((camera.screenOffsetX || 0) * displayW) / width;
    const cWorld = body.position.map((v, i) => v - camera.position[i]);
    const bounds = sphereRasterBounds(
      cWorld[0] * camera.right[0] +
        cWorld[1] * camera.right[1] +
        cWorld[2] * camera.right[2],
      cWorld[0] * camera.up[0] +
        cWorld[1] * camera.up[1] +
        cWorld[2] * camera.up[2],
      cWorld[0] * camera.forward[0] +
        cWorld[1] * camera.forward[1] +
        cWorld[2] * camera.forward[2],
      Math.max(body.radius, ...(state.baseRadiiMeters || [body.radius])) +
        Math.max(
          Math.abs(Number(state.minElevationMeters ?? 0)),
          Math.abs(Number(state.maxElevationMeters ?? 0)),
        ) *
          Number(state.exaggeration ?? 1) *
          Math.max(
            0,
            Math.min(
              1,
              Number(state.displacement ?? state.displacementFactor ?? 1),
            ),
          ),
      displayW,
      displayH,
      focal,
      offset,
    );
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top)
      return false;
    const entry = this._prepareEntry(body.id, {
      color,
      height: heightMap,
      region,
      colorRegion,
      previousColor: previousColor === color ? null : previousColor,
      previousHeight: previousHeight === heightMap ? null : previousHeight,
      previousRegion: previousRegion === region ? null : previousRegion,
      previousColorRegion:
        previousColorRegion === colorRegion ? null : previousColorRegion,
    });
    entry.lastUsed = ++this.frame;
    const colorTexture = this._texture(entry, "color", color),
      previousColorTexture =
        previousColor === color
          ? colorTexture
          : this._texture(entry, "previousColor", previousColor),
      heightTexture = heightMap
        ? this._texture(entry, "height", heightMap)
        : null,
      previousHeightTexture =
        previousHeight === heightMap
          ? heightTexture
          : previousHeight
            ? this._texture(entry, "previousHeight", previousHeight)
            : null,
      regionTexture = region ? this._texture(entry, "region", region) : null,
      colorRegionTexture = colorRegion
        ? this._texture(entry, "colorRegion", colorRegion)
        : null,
      previousColorRegionTexture =
        previousColorRegion === colorRegion
          ? colorRegionTexture
          : previousColorRegion
            ? this._texture(entry, "previousColorRegion", previousColorRegion)
            : null,
      previousRegionTexture =
        previousRegion === region
          ? regionTexture
          : previousRegion
            ? this._texture(entry, "previousRegion", previousRegion)
            : null;
    if (!colorTexture || !previousColorTexture || (heightMap && !heightTexture))
      return false;
    try {
      gl.bindVertexArray(this.vao);
      gl.useProgram(this.program);
      const sx = w / displayW,
        sy = h / displayH;
      const cropLeft = Math.floor(bounds.left),
        cropTop = Math.floor(bounds.top),
        cropRight = Math.ceil(bounds.right),
        cropBottom = Math.ceil(bounds.bottom),
        sourceLeft = Math.floor(cropLeft * sx),
        sourceTop = Math.floor(cropTop * sy),
        sourceRight = Math.ceil(cropRight * sx),
        sourceBottom = Math.ceil(cropBottom * sy),
        cropWidth = Math.max(1, cropRight - cropLeft),
        cropHeight = Math.max(1, cropBottom - cropTop),
        sourceWidth = Math.max(1, sourceRight - sourceLeft),
        sourceHeight = Math.max(1, sourceBottom - sourceTop);
      gl.viewport(0, 0, w, h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(sourceLeft, h - sourceBottom, sourceWidth, sourceHeight);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const u = this.uniforms;
      // These depend only on resident descriptors, never on a ray sample.
      let normalStep=Math.PI/(heightMap?.height || 1);
      let cellStep=normalStep*.25;
      for(const layer of region?.layers || []) {
        const angular=layer.projection==="polar-stereographic"
          ? 4*Math.tan((90-(layer.capLatitude??70))*Math.PI/360) : Math.PI;
        const spacing=angular*(layer.uvBounds[3]-layer.uvBounds[1])/layer.height;
        normalStep=Math.min(normalStep,spacing);
        cellStep=Math.min(cellStep,spacing*.75);
      }
      gl.uniform1f(u.uNormalStep,Math.max(normalStep,1e-7));
      gl.uniform1f(u.uCellStep,cellStep);
      for (const [prefix, atlas] of [
        ["CurrentHeight", region],
        ["PreviousHeight", previousRegion],
        ["CurrentColor", colorRegion],
        ["PreviousColor", previousColorRegion],
      ]) {
        gl.uniform1i(u[`u${prefix}Count`], atlas?.count || 0);
        if (atlas) {
          atlas.layers.forEach((layer, index) => {
            atlas.params[index * 4 + 3] = layer.detailBlend ?? 1;
            atlas.edges.set(detailEdges(layer, atlas.layers), index * 4);
          });
          for (const field of ["Bounds", "Cells", "Params", "Edges"])
            gl.uniform4fv(u[`u${prefix}${field}`], atlas[field.toLowerCase()]);
        }
      }
      gl.uniform2f(u.uSize, w, h);
      gl.uniform1f(u.uFocal, rasterFocal);
      gl.uniform1f(u.uOffsetX, offset * sx);
      gl.uniform1f(u.uRadius, 1);
      gl.uniform1f(u.uPhysicalRadius, radius);
      gl.uniform1f(u.uExaggeration, Number(state.exaggeration ?? 1));
      gl.uniform1f(u.uHeightScale, 1 / radius);
      gl.uniform1f(
        u.uDisplacement,
        Math.max(
          0,
          Math.min(
            1,
            Number(state.displacement ?? state.displacementFactor ?? 1),
          ),
        ),
      );
      gl.uniform1f(
        u.uBlend,
        Math.max(0, Math.min(1, Number(state.blend ?? 1))),
      );
      gl.uniform1f(u.uMicroDetail, Number(state.microDetail ?? 1));
      gl.uniform1f(u.uDisplayExposure, Number(state.displayExposure ?? 1));
      gl.uniform3fv(
        u.uBaseAxes,
        (state.baseRadiiMeters || [radius, radius, radius]).map(
          (r) => r / radius,
        ),
      );
      gl.uniform1f(u.uWater, state.waterSurface ? 1 : 0);
      gl.uniform1f(u.uEmissive, state.emissive ? 1 : 0);
      const axes = (state.baseRadiiMeters || [radius, radius, radius]).map(
        (r) => r / radius,
      );
      const ellipsoidDistance = Math.hypot(
        ...origin.map((v, i) => v / axes[i]),
      );
      gl.uniform1f(
        u.uEllipsoidC,
        (ellipsoidDistance - 1) * (ellipsoidDistance + 1),
      );
      gl.uniform3fv(u.uAtmosphereColor, state.atmosphere?.color || [0, 0, 0]);
      gl.uniform1f(u.uAtmosphereOpacity, state.atmosphereOpacity || 0);
      gl.uniform1f(u.uAtmosphericBands, state.atmosphericBands ? 1 : 0);
      gl.uniform1f(
        u.uMaxRayIterations,
        Math.max(1, Math.min(256, Number(quality.maxRayIterations) || 256)),
      );
      gl.uniform3fv(u.uOrigin, origin);
      gl.uniform3fv(u.uDirection, direction);
      gl.uniform3fv(u.uRight, right);
      gl.uniform3fv(u.uUp, up);
      const lp = light?.position
        ? project(light.position.map((v, i) => v - body.position[i]))
        : camera.position.map((v, i) => v - body.position[i]);
      gl.uniform3fv(
        u.uLight,
        lp.map((v) => v / radius),
      );
      gl.uniform1f(
        u.uMinHeight,
        Number(state.minElevationMeters ?? 0) / radius,
      );
      gl.uniform1f(
        u.uMaxHeight,
        Number(state.maxElevationMeters ?? 0) / radius,
      );
      gl.uniform1f(u.uHasHeight, heightTexture ? 1 : 0);
      gl.uniform1f(
        u.uOpacity,
        Math.max(0, Math.min(1, Number(state.transition ?? 1))),
      );
      gl.uniform1f(u.uHasPreviousHeight, previousHeightTexture ? 1 : 0);
      gl.uniform1f(u.uHasRegion, regionTexture ? 1 : 0);
      gl.uniform1f(u.uHasPreviousRegion, previousRegionTexture ? 1 : 0);
      gl.uniform1f(u.uHasColorRegion, colorRegionTexture ? 1 : 0);
      gl.uniform1f(
        u.uHasPreviousColorRegion,
        previousColorRegionTexture ? 1 : 0,
      );
      gl.uniform1f(
        u.uColorRegionBlendBorder,
        Math.max(
          0,
          Number(
            colorRegion?.blendBorder ??
              previousColorRegion?.blendBorder ??
              0.025,
          ),
        ),
      );
      gl.uniform1f(
        u.uRegionBlendBorder,
        Math.max(
          0,
          Number(region?.blendBorder ?? previousRegion?.blendBorder ?? 0.08),
        ),
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, colorTexture);
      gl.uniform1i(u.uColor, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, previousColorTexture);
      gl.uniform1i(u.uColorPrev, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, heightTexture || colorTexture);
      gl.uniform1i(u.uHeight, 2);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(
        gl.TEXTURE_2D,
        previousHeightTexture || heightTexture || colorTexture,
      );
      gl.uniform1i(u.uHeightPrev, 3);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(
        gl.TEXTURE_2D,
        regionTexture || heightTexture || colorTexture,
      );
      gl.uniform1i(u.uRegion, 4);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(
        gl.TEXTURE_2D,
        previousRegionTexture ||
          previousHeightTexture ||
          heightTexture ||
          colorTexture,
      );
      gl.uniform1i(u.uPreviousRegion, 5);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, colorRegionTexture || colorTexture);
      gl.uniform1i(u.uColorRegion, 6);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(
        gl.TEXTURE_2D,
        previousColorRegionTexture || previousColorTexture,
      );
      gl.uniform1i(u.uPreviousColorRegion, 7);
      gl.uniform2i(
        u.uHeightSize,
        heightMap?.width || 1,
        heightMap?.height || 1,
      );
      gl.uniform2i(
        u.uPreviousHeightSize,
        previousHeight?.width || heightMap?.width || 1,
        previousHeight?.height || heightMap?.height || 1,
      );
      gl.uniform2i(u.uRegionSize, region?.width || 1, region?.height || 1);
      gl.uniform2i(
        u.uPreviousRegionSize,
        previousRegion?.width || 1,
        previousRegion?.height || 1,
      );
      gl.uniform4f(u.uRegionBounds, ...(region?.uvBounds || [0, 0, 1, 1]));
      gl.uniform4f(
        u.uPreviousRegionBounds,
        ...(previousRegion?.uvBounds || [0, 0, 1, 1]),
      );
      gl.uniform4f(
        u.uColorRegionBounds,
        ...(colorRegion?.uvBounds || [0, 0, 1, 1]),
      );
      gl.uniform4f(
        u.uPreviousColorRegionBounds,
        ...(previousColorRegion?.uvBounds || [0, 0, 1, 1]),
      );
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.SCISSOR_TEST);
      ctx.drawImage(
        this.canvas,
        sourceLeft,
        sourceTop,
        sourceWidth,
        sourceHeight,
        cropLeft,
        cropTop,
        cropWidth,
        cropHeight,
      );
      this.prune();
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  prune(maxTextures = this.maxTextures) {
    const victims = [...this.cache.entries()].sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    );
    const gl = this.gl;
    while (
      victims.length > maxTextures ||
      (victims.length > 1 && this.stats().memoryBytes > this.budgetBytes)
    ) {
      const [key, item] = victims.shift();
      if (item.gpu)
        for (const texture of Object.values(item.gpu))
          gl?.deleteTexture(texture?.texture);
      this.cache.delete(key);
    }
    return this.stats();
  }
  retain(bodyIds) {
    for (const [id, entry] of this.cache)
      if (!bodyIds.has(id)) {
        for (const texture of Object.values(entry.gpu || {}))
          this.gl?.deleteTexture(texture.texture);
        this.cache.delete(id);
      }
  }
  stats() {
    let memoryBytes = 0;
    for (const item of this.cache.values())
      for (const texture of Object.values(item.gpu || {}))
        if (texture?.width && texture?.height)
          memoryBytes +=
            texture.width *
            texture.height *
            (texture === item.gpu.color || texture === item.gpu.previousColor
              ? 4
              : 4);
    return {
      textures: this.cache.size,
      gpuTextures: [...this.cache.values()].reduce(
        (n, e) => n + Object.values(e.gpu || {}).filter(Boolean).length,
        0,
      ),
      memoryBytes,
      maxTextures: this.maxTextures,
      error: this.error,
      contextLost: this.lost,
    };
  }
  dispose() {
    const gl = this.gl;
    for (const item of this.cache.values())
      for (const texture of Object.values(item.gpu || {}))
        gl?.deleteTexture(texture?.texture);
    this.cache.clear();
    if (gl && this.program) gl.deleteProgram(this.program);
    this.canvas?.removeEventListener?.("webglcontextlost", this._onLost);
    this.canvas?.removeEventListener?.(
      "webglcontextrestored",
      this._onRestored,
    );
    this.program = null;
    this.gl = null;
  }
}

export const TERRAIN_GPU_SURFACE_STATE =
  "frame + asset(color RGBA8, optional height R32F Float32Array) + referenceRadiusMeters + optional exaggeration/bounds/transition";
