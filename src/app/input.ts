export type Action = 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'dash' | 'primary' | 'secondary' | 'max' | 'wager' | 'aura' | 'interact' | 'camera' | 'pause' | 'fullsign' | 'workshop' | 'map';

const bindings: Record<string, Action> = {
  KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint', Space: 'jump', KeyC: 'dash', KeyQ: 'max', KeyR: 'wager', KeyF: 'aura', KeyE: 'interact', KeyV: 'camera',
  Escape: 'pause', AltLeft: 'fullsign', Tab: 'workshop', KeyM: 'map',
  Mouse0: 'primary', Mouse2: 'secondary',
};

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  readonly look = { x: 0, y: 0 };
  wheel = 0;
  locked = false;
  onLockLost: (() => void) | null = null;
  private releasing = false;
  enabled = true;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      const a = bindings[e.code];
      if (!a) return;
      if (a === 'workshop' || a === 'fullsign') e.preventDefault();
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = bindings[e.code];
      if (!a) return;
      this.down.delete(a);
      this.released.add(a);
    });
    canvas.addEventListener('mousedown', (e) => {
      const a = bindings[`Mouse${e.button}`];
      if (!a) return;
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener('mouseup', (e) => {
      const a = bindings[`Mouse${e.button}`];
      if (!a) return;
      this.down.delete(a);
      this.released.add(a);
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.look.x += e.movementX;
      this.look.y += e.movementY;
    });
    window.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      // Chrome spends the first Esc on leaving pointer lock and never delivers
      // the keydown, so a lock we did not release ourselves counts as a pause.
      if (was && !this.locked && !this.releasing) this.onLockLost?.();
      this.releasing = false;
    });
    window.addEventListener('blur', () => this.clear());
  }

  requestLock(): void {
    if (this.locked) return;
    try { const r = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined; r?.catch?.(() => undefined); } catch { /* not permitted here */ }
  }

  releaseLock(): void {
    if (!this.locked) return;
    this.releasing = true;
    document.exitPointerLock();
  }

  isDown(a: Action): boolean { return this.enabled && this.down.has(a); }
  hit(a: Action): boolean { return this.enabled && this.pressed.has(a); }
  up(a: Action): boolean { return this.enabled && this.released.has(a); }

  axis(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    const x = (this.down.has('right') ? 1 : 0) - (this.down.has('left') ? 1 : 0);
    const y = (this.down.has('forward') ? 1 : 0) - (this.down.has('back') ? 1 : 0);
    const l = Math.hypot(x, y) || 1;
    return { x: x / l, y: y / l };
  }

  consumeLook(): { x: number; y: number } {
    const r = { x: this.look.x, y: this.look.y };
    this.look.x = 0; this.look.y = 0;
    return r;
  }

  endFrame(): void {
    this.pressed.clear();
    this.released.clear();
    this.wheel = 0;
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
    this.released.clear();
  }

  // Debug and capture harness: synthesize an action for one frame or hold it.
  inject(a: Action, held: boolean): void {
    if (held) { if (!this.down.has(a)) this.pressed.add(a); this.down.add(a); }
    else { this.down.delete(a); this.released.add(a); }
  }
}
