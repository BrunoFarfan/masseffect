export const add = (a, b) => a.map((v, i) => v + b[i]);
export const sub = (a, b) => a.map((v, i) => v - b[i]);
export const mul = (a, k) => a.map((v) => v * k);
export const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
export const length = (a) => Math.hypot(...a);
export const unit = (a) => mul(a, 1 / (length(a) || 1));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
