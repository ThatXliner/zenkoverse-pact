// Game time with hit-stop and slow motion. `dt` is the scaled frame delta,
// `raw` the unscaled one for UI and camera shake that must keep moving.
// In an online room the world is shared, so `shared` keeps time at its real
// rate: hit-stop and the Maximum Output slow-down stay presentation (the
// shake, the impact frame, the cutscene's own camera), never a freeze.
export class GameClock {
  dt = 0;
  raw = 0;
  time = 0;
  private last = performance.now();
  private freezeLeft = 0;
  slowMo = 1;
  forced: number | null = null;
  shared = false;

  tick(): void {
    const now = performance.now();
    this.raw = this.forced ?? Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.freezeLeft > 0) {
      this.freezeLeft -= this.raw;
      this.dt = this.shared ? this.raw : this.raw * 0.04;
    } else if (this.shared) {
      this.dt = this.raw;
    } else {
      this.dt = this.raw * this.slowMo;
    }
    this.time += this.dt;
  }

  // Hit-stop: near-total freeze for a few frames, scaled to the blow.
  hitStop(seconds: number): void {
    this.freezeLeft = Math.max(this.freezeLeft, seconds);
  }

  get frozen(): boolean { return this.freezeLeft > 0; }
}
