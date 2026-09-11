export const FRAGMENT_LIMITS = [4, 8, 16, 32, 64];

// Estimate prospective work, never remove existing debris to recover speed.
// The usual physics frame budget still slows simulated time under heavy load.
export class FragmentBudget {
  constructor() {
    this.pairCost = 0;
    this.drawCost = 0;
    this.samples = 0;
  }
  observeStep(ms, count) {
    if (++this.samples <= 8) return; // let the small kernels warm up
    this.pairCost = this.smooth(
      this.pairCost,
      ms / Math.max(256, count * (count - 1)),
    );
  }
  observeDraw(ms, count) {
    this.drawCost = this.smooth(this.drawCost, ms / Math.max(16, count));
  }
  smooth(old, value) {
    return old ? old * 0.9 + Math.min(old * 2, value) * 0.1 : value;
  }
  limit(requested, bodyCount) {
    for (const fragments of [...FRAGMENT_LIMITS].reverse()) {
      const count = bodyCount - 2 + fragments;
      if (
        fragments <= requested &&
        count <= 128 &&
        this.pairCost * count * Math.max(1, count - 1) <= 2 &&
        this.drawCost * count <= 10
      )
        return fragments;
    }
    return 4;
  }
}
