// The recorded half of the sound: the files listed under `audio` in the asset
// manifest, fetched and decoded only once the player has clicked (the boot
// bar never waits on them). A cue that asks for a file still on its way plays
// its synthesized layers alone.
interface Entry { url: string; bytes: number }

export class Library {
  private buffers = new Map<string, AudioBuffer>();
  private started = false;
  total = 0;
  loaded = 0;
  failed = 0;

  constructor(private base: string) {}

  get(name: string): AudioBuffer | undefined { return this.buffers.get(name); }
  has(name: string): boolean { return this.buffers.has(name); }

  // Idempotent: the first call starts the download, later calls do nothing.
  load(ctx: AudioContext): void {
    if (this.started) return;
    this.started = true;
    void (async () => {
      let list: Entry[] = [];
      try { list = ((await (await fetch(`${this.base}assets/manifest.json`)).json()) as { audio?: Entry[] }).audio ?? []; } catch { return; }
      this.total = list.length;
      const queue = [...list];
      const worker = async (): Promise<void> => {
        for (let e = queue.shift(); e; e = queue.shift()) {
          const name = e.url.replace(/^assets\/audio\//, '').replace(/\.\w+$/, '');
          try {
            const buf = await (await fetch(`${this.base}${e.url}`)).arrayBuffer();
            this.buffers.set(name, await ctx.decodeAudioData(buf));
            this.loaded++;
          } catch { this.failed++; }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
    })();
  }
}
