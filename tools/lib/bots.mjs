// Headless room members for the multiplayer checks: each one speaks the same
// protocol as the browser (src/net/protocol.ts), walks a circle in the
// courtyard at running speed, casts now and then with a ring of effects, and
// takes every hit it is dealt in full. They fill a room to measure frame
// times without eight GPUs.
const TECHS = ['recoil', 'shift', 'rime', 'blink', 'echo'];
const COLORS = { recoil: 0xff7a2f, shift: 0x6fd3ff, rime: 0x9fe8ff, blink: 0xc6a8ff, echo: 0x7dffb2 };

export function wsUrl(pageUrl) {
  const u = new URL('ws', pageUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

export function bot(pageUrl, room, i, { center = [-3, 0, 4], radius = 4 + (i % 3) * 1.5, speed = 4.1, castEvery = 2.5 } = {}) {
  const ws = new WebSocket(wsUrl(pageUrl));
  const tech = TECHS[i % TECHS.length];
  const t0 = performance.now();
  let timer = null, id = null, lastCast = 0;
  const send = (m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => send({ type: 'hello', room, name: `Bot ${i + 1}`, token: `bot-${room}-${i}-${Math.random()}`, tech }));
    ws.addEventListener('error', () => reject(new Error('bot socket failed')));
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === 'welcome') { id = m.id; resolve(id); }
      if (m.type === 'full') reject(new Error('room full'));
      if (m.type === 'struck') send({ type: 'resolve', hit: m.hit, taken: m.amount });
    });
  });
  timer = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const w = speed / radius, a = t * w + i * 0.9;
    const p = [center[0] + Math.cos(a) * radius, center[1], center[2] + Math.sin(a) * radius];
    const v = [-Math.sin(a) * speed, 0, Math.cos(a) * speed];
    send({ type: 'state', s: { ct: performance.now(), p, v, yaw: Math.atan2(-v[0], -v[2]), pitch: 0, g: true, sign: 0, cine: false } });
    if (t - lastCast > castEvery) {
      lastCast = t;
      const at = [p[0], 1.2, p[2]];
      const ct = performance.now();
      send({ type: 'cast', ct, kind: 'primary', tech, name: 'Raw', dir: [v[0] / speed, 0, v[2] / speed] });
      send({ type: 'fx', ct, calls: [{ f: 'ring', a: [{ v: at }, COLORS[tech], 0.2, 2.5, 0.4] }, { f: 'burst', a: [{ v: at }, 10, 'spark', 5, COLORS[tech]] }] });
    }
  }, 50);
  return { ready, get id() { return id; }, close() { clearInterval(timer); send({ type: 'bye' }); ws.close(); } };
}
