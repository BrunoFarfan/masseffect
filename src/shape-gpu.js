import { cross, sub, unit, dot } from "./math.js";

// Only the irregular-body strategy differs: measured triangles share the
// surrounding scene, frame, asset lifetime and SI camera with DEM surfaces.
const VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
uniform vec3 origin, right, up, forward;
uniform vec2 viewport;
uniform float focal, offset, nearPlane, farPlane;
out vec3 point, surfaceNormal;
void main(){
  vec3 relative=position-origin;
  float z=dot(relative,forward);
  gl_Position=vec4(2.0*focal*dot(relative,right)/viewport.x+2.0*offset*z/viewport.x,
    2.0*focal*dot(relative,up)/viewport.y,
    (farPlane+nearPlane)/(farPlane-nearPlane)*z-2.0*farPlane*nearPlane/(farPlane-nearPlane),z);
  point=position; surfaceNormal=normal;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 point,surfaceNormal;
uniform vec3 light, color;
uniform float opacity, physicalRadius;
out vec4 result;
float grain(vec3 p){
  return sin(p.x*.73+sin(p.z*.51))*sin(p.y*.67-p.z*.39);
}
void main(){
  vec3 p=point*physicalRadius;
  float footprint=max(length(dFdx(p)),length(dFdy(p)));
  float detail=1.0-smoothstep(2.0,12.0,footprint);
  vec3 gradient=vec3(grain(p+vec3(.5,0,0))-grain(p-vec3(.5,0,0)),grain(p+vec3(0,.5,0))-grain(p-vec3(0,.5,0)),grain(p+vec3(0,0,.5))-grain(p-vec3(0,0,.5)));
  // Synthetic sub-resolution roughness only; mesh silhouettes/clearance remain measured.
  vec3 normal=normalize(surfaceNormal+detail*.08*gradient);
  float direct=max(0.0,dot(normal,normalize(light-point)));
  result=vec4(pow(pow(color,vec3(2.2))*(0.10+0.90*direct)*(1.0+.05*detail*grain(p)),vec3(1.0/2.2)),opacity);
}`;

export class ShapeGPU {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    this.cache = new Map();
    this.error = null;
    if (!this.gl) return;
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.program = null;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.cache.clear();
      this.build();
    });
    this.build();
  }
  build() {
    const gl = this.gl;
    try {
      const program = gl.createProgram();
      for (const [type, source] of [
        [gl.VERTEX_SHADER, VERTEX],
        [gl.FRAGMENT_SHADER, FRAGMENT],
      ]) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
        gl.deleteShader(shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program));
      this.program = program;
      this.uniforms = Object.fromEntries(
        [
          "origin",
          "right",
          "up",
          "forward",
          "viewport",
          "focal",
          "offset",
          "nearPlane",
          "farPlane",
          "light",
          "color",
          "opacity",
          "physicalRadius",
        ].map((name) => [name, gl.getUniformLocation(program, name)]),
      );
      this.error = null;
    } catch (error) {
      this.error = error.message;
      this.program = null;
    }
  }
  retain(ids) {
    for (const [id, entry] of this.cache)
      if (!ids.has(id)) {
        this.gl.deleteBuffer(entry.buffer);
        this.gl.deleteVertexArray(entry.vao);
        this.cache.delete(id);
      }
  }
  draw(ctx, body, camera, width, height, light, state) {
    if (!this.program || !state?.asset?.shape) return false;
    const gl = this.gl,
      shape = state.asset.shape,
      radius = state.referenceRadiusMeters;
    let entry = this.cache.get(body.id);
    if (!entry || entry.shape !== shape) {
      if (entry) {
        gl.deleteBuffer(entry.buffer);
        gl.deleteVertexArray(entry.vao);
      }
      const data = new Float32Array(shape.indices.length * 6);
      const normals = shape.vertices.map(() => [0, 0, 0]);
      for (let i = 0; i < shape.indices.length; i += 3) {
        const [a, b, c] = shape.indices.slice(i, i + 3),
          n = cross(
            sub(shape.vertices[b], shape.vertices[a]),
            sub(shape.vertices[c], shape.vertices[a]),
          );
        for (const index of [a, b, c])
          for (let k = 0; k < 3; k++) normals[index][k] += n[k];
      }
      for (let i = 0; i < shape.indices.length; i++) {
        const index = shape.indices[i];
        data.set(
          shape.vertices[index].map((v) => v / radius),
          i * 6,
        );
        data.set(unit(normals[index]), i * 6 + 3);
      }
      const vao = gl.createVertexArray(),
        buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      for (let i = 0; i < 2; i++) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, i * 12);
      }
      entry = {
        shape,
        vao,
        buffer,
        count: shape.indices.length,
        bytes: data.byteLength,
      };
      this.cache.set(body.id, entry);
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const local = (v) => [
      dot(v, state.frame.prime),
      dot(v, state.frame.north),
      dot(v, state.frame.east),
    ];
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    // The reflected world uses a left-handed camera projection. Outward
    // shape triangles therefore arrive clockwise in screen space.
    gl.frontFace(gl.CW);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.useProgram(this.program);
    gl.bindVertexArray(entry.vao);
    const u = this.uniforms;
    gl.uniform3fv(
      u.origin,
      local(sub(camera.position, body.position)).map((v) => v / radius),
    );
    for (const axis of ["right", "up", "forward"])
      gl.uniform3fv(u[axis], local(camera[axis]));
    gl.uniform2f(u.viewport, width, height);
    gl.uniform1f(u.focal, height * 0.95);
    gl.uniform1f(u.offset, camera.screenOffsetX || 0);
    const distance = Math.hypot(...sub(camera.position, body.position));
    gl.uniform1f(
      u.nearPlane,
      Math.max(0.02, (distance - shape.maxRadius) * 0.5) / radius,
    );
    gl.uniform1f(u.farPlane, (distance + shape.maxRadius * 1.05) / radius);
    gl.uniform3fv(
      u.light,
      local(sub(light?.position || camera.position, body.position)).map(
        (v) => v / radius,
      ),
    );
    const rgb = body.color
      .match(/[0-9a-f]{2}/gi)
      ?.map((v) => parseInt(v, 16) / 255) || [0.6, 0.57, 0.52];
    gl.uniform3fv(u.color, rgb);
    gl.uniform1f(u.opacity, 1);
    gl.uniform1f(u.physicalRadius, radius);
    gl.drawArrays(gl.TRIANGLES, 0, entry.count);
    ctx.drawImage(this.canvas, 0, 0, width, height);
    return true;
  }
  stats() {
    return {
      bodies: this.cache.size,
      memoryBytes: [...this.cache.values()].reduce((n, e) => n + e.bytes, 0),
      error: this.error,
    };
  }
}
