// The recorded half of the sound: the pack listed under `audio` in the asset
// manifest, fetched and decoded only once the player has clicked (the boot
// bar never waits on it). One request carries every recording; they decode
// one at a time so the burst never competes with the game. A cue that asks
// for a file still on its way plays its synthesized layers alone.
//
// The pack (tools/build-assets.mjs): a little-endian u32 header length, a
// JSON index of [name, offset, length], then the Ogg files back to back.
interface Entry { url: string; bytes: number }
type Index = [string, number, number][];

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
      let packs: Entry[] = [];
      try { packs = ((await (await fetch(`${this.base}assets/manifest.json`)).json()) as { audio?: Entry[] }).audio ?? []; } catch { return; }
      for (const p of packs) {
        let data: ArrayBuffer;
        try { data = await (await fetch(`${this.base}${p.url}`)).arrayBuffer(); } catch { this.failed++; continue; }
        const headLen = new DataView(data).getUint32(0, true);
        const index = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 4, headLen))) as Index;
        const body = 4 + headLen;
        this.total += index.length;
        for (const [name, offset, length] of index) {
          try {
            this.buffers.set(name, await ctx.decodeAudioData(data.slice(body + offset, body + offset + length)));
            this.loaded++;
          } catch { this.failed++; }
        }
      }
    })();
  }
}
