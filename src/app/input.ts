import { actionFor, capturing, type Action } from './keymap';

export type { Action };

export class Input {
  private down = new Set<Action>();
  private pressed = new Set<Action>();
  private released = new Set<Action>();
  readonly look = { x: 0, y: 0 };
  // The cursor in normalized device coordinates, for the top-down aim.
  readonly mouse = { x: 0, y: 0 };
  wheel = 0;
  locked = false;
  onLockLost: (() => void) | null = null;
  private releasing = false;
  enabled = true;
  // Any mouse press on the canvas, whatever it is bound to. The first one after the cursor is released takes the pointer lock back.
  canvasPressed = false;

  constructor(private canvas: HTMLCanvasElement) {
    const press = (code: string, e: Event): void => {
      if (capturing.value) return;
      const a = actionFor(code);
      if (!a) return;
      if (a === 'workshop' || a === 'fullsign') e.preventDefault();
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    };
    const release = (code: string, e: Event): void => {
      const a = actionFor(code);
      if (!a) return;
      if (Number(code.slice(5)) > 2 && code.startsWith('Mouse') && e.cancelable) e.preventDefault();
      this.down.delete(a);
      this.released.add(a);
    };
    window.addEventListener('keydown', (e) => press(e.code, e));
    window.addEventListener('keyup', (e) => release(e.code, e));
    canvas.addEventListener('mousedown', (e) => {
      this.canvasPressed = true;
      // Side buttons would step the browser back on release.
      if (e.button > 2 && actionFor(`Mouse${e.button}`)) e.preventDefault();
      press(`Mouse${e.button}`, e);
    });
    window.addEventListener('mouseup', (e) => release(`Mouse${e.button}`, e));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
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
  // Esc must work while a sheet blocks the rest of the input.
  hitAny(a: Action): boolean { return this.pressed.has(a); }
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
    this.canvasPressed = false;
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
