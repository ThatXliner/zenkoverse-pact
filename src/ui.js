import { TECHNIQUES, EYES, CODEX } from './data.js';

let cache = {};
const $ = (sel) => (cache[sel] ??= document.querySelector(sel));
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

export class UI {
  constructor() {
    this.numberLayer = $('#numbers');
    this.modal = $('#modal');
    this.hud = $('#hud');
    this.bannerEl = $('#banner');
    this.toasts = $('#toasts');
    this.boss = null;
    this.bannerTimer = 0;
  }

  // ---------- title ----------

  showTitle(onPick) {
    const grid = $('#tech-grid');
    grid.innerHTML = '';
    for (const [key, t] of Object.entries(TECHNIQUES)) {
      const card = document.createElement('button');
      card.className = 'tech-card';
      card.style.setProperty('--c', hex(t.color));
      card.innerHTML = `
        <div class="art" style="background-image:url(${t.img})"></div>
        <div class="body">
          <div class="kicker">${t.type}</div>
          <h3>${t.name}</h3>
          <p>${t.blurb}</p>
          <ul>${t.controls.map(([k, d]) => `<li><kbd>${k}</kbd>${d}</li>`).join('')}</ul>
          <p class="note">${t.note}</p>
        </div>`;
      card.addEventListener('click', () => onPick(key));
      grid.appendChild(card);
    }
    $('#title').classList.remove('hidden');
    this.hud.classList.add('hidden');
  }

  hideTitle() { $('#title').classList.add('hidden'); }

  showControlsHint(g) {
    const t = g.player.def;
    const el = $('#howto');
    el.innerHTML = [
      ['WASD', 'move'], ['Mouse', 'aim'], ['LMB', t.controls[0][1].split(':')[0]], [t.controls[1][0].replace(' (hold)', ''), t.controls[1][1].split(':')[0]],
      ['Space', 'dash'], ['R', 'Wager: next hit ×3 or sealed'], ['Q', 'Max Output when the ring fills'], ['Esc', 'codex'],
    ].map(([k, d]) => `<span><kbd>${k}</kbd>${d}</span>`).join('');
    el.classList.remove('hidden', 'out');
    clearTimeout(this.howtoT);
    this.howtoT = setTimeout(() => el.classList.add('out'), 11000);
  }

  // ---------- HUD ----------

  showHud(g) {
    cache = {};
    this.hideTitle();
    this.closeModal();
    this.hud.classList.remove('hidden');
    const t = g.player.def;
    this.hud.style.setProperty('--c', hex(t.color));
    $('#hud-tech').textContent = t.name;
    $('#res-label').textContent = t.resource;
    $('#eye-loss').classList.add('hidden');
    $('#hud-eye').classList.add('hidden');
    this.bossBar(null);
    const keys = [
      ['LMB', t.controls[0][1].split(':')[0], 'atk'],
      [t.controls[1][0].replace(' (hold)', ''), t.controls[1][1].split(':')[0], 'rmb'],
      ['SPACE', 'Dash', 'dash'],
      ['Q', 'Max Output', 'max'],
      ['R', 'Wager', 'wager'],
      ['F', 'Aura', 'aura'],
      ['E', 'Vault', 'vault'],
    ];
    $('#abilities').innerHTML = keys.map(([k, n, id]) => `<div class="ab" id="ab-${id}"><kbd>${k}</kbd><span>${n}</span><i></i></div>`).join('');
  }

  updateHud(g) {
    const p = g.player;
    $('#hp-fill').style.width = `${(p.hp / p.maxHp) * 100}%`;
    $('#hp-text').textContent = `${Math.ceil(p.hp)} / ${Math.round(p.maxHp)}`;
    const resFrac = p.res / p.resMax;
    $('#res-fill').style.width = `${resFrac * 100}%`;
    $('#res-fill').classList.toggle('danger', (p.tech === 'rime' && resFrac >= 1) || (p.tech === 'recoil' && resFrac >= 1));
    $('#max-fill').style.height = `${p.maxCharge}%`;
    $('#max-wrap').classList.toggle('ready', p.maxCharge >= 100 || (g.flags.overext && p.maxCharge >= 50));
    $('#hud-wave').textContent = `Wave ${g.waveIndex + 1} — ${g.enemies.length + g.spawnQueue.length} remaining`;
    $('#hud-resolve').textContent = `Resolve ${g.resolve}`;
    $('#hud-score').textContent = `${g.score}`;

    if (p.tech === 'blink') {
      $('#stare').classList.remove('hidden');
      $('#stare').textContent = `Staring ×${(1 + p.stare * 0.5).toFixed(1)}`;
    } else $('#stare').classList.add('hidden');

    const setAb = (id, cd, max, extra = '') => {
      const el = $(`#ab-${id}`);
      if (!el) return;
      el.querySelector('i').style.height = `${Math.min(1, cd / max) * 100}%`;
      el.className = `ab ${extra}`;
    };
    const sealed = p.sealed > 0 ? 'sealed' : '';
    setAb('atk', p.atkCd, 0.5, sealed);
    setAb('rmb', p.rmbCd, 1.1, sealed);
    setAb('dash', p.dashCd, 0.9, g.flags.nodash ? 'off' : '');
    setAb('max', 100 - p.maxCharge, 100, (p.maxCharge >= 100 ? 'ready ' : '') + sealed);
    setAb('wager', p.wager.cd, 5, p.wager.armed ? 'armed' : '');
    setAb('aura', 100 - p.aura.energy, 100, g.auraUnlocked ? (p.aura.active ? 'armed' : '') : 'off');
    setAb('vault', p.vaultCd, 0.9, p.eye === 'vault' ? '' : 'off');

    $('#sealed').classList.toggle('hidden', p.sealed <= 0);
    $('#sealed').textContent = `TECHNIQUE SEALED ${p.sealed.toFixed(1)}s`;
    $('#blind').style.opacity = p.blind > 0 ? String(Math.min(1, p.blind) * 0.94) : '0';
    $('#pressure').style.opacity = p.pressured ? '1' : '0';

    const clash = $('#clash');
    clash.classList.toggle('hidden', !g.clashing);
    if (g.clashing) $('#clash-marker').style.left = `${50 + g.clash * 50}%`;

    // Pacts light up only while their conditions hold.
    const list = $('#pacts');
    if (list.childElementCount !== g.pacts.length) {
      list.innerHTML = g.pacts.map((pc) => `<li data-id="${pc.id}"><b>${pc.name}</b><small>${pc.kind}${pc.shared ? ' · shared sacrifice' : ''}</small></li>`).join('');
    }
    for (const li of list.children) {
      const pc = g.pacts.find((x) => x.id === li.dataset.id);
      const passive = pc.cond === 'never';
      li.classList.toggle('lit', passive || g.pactActive(pc));
      li.classList.toggle('expired', pc.cond === 'sunset' && pc.wave < g.waveIndex);
    }

    if (this.boss) {
      const b = this.boss;
      $('#boss-fill').style.width = `${Math.max(0, b.hp / b.maxHp) * 100}%`;
    }
    this.bannerTimer -= 1 / 60;
  }

  bossBar(e) {
    this.boss = e;
    $('#boss').classList.toggle('hidden', !e);
    if (e) {
      $('#boss-name').textContent = e.def.name;
      $('#boss-fill').style.background = hex(e.def.color);
    }
  }

  banner(title, sub = '') {
    const b = this.bannerEl;
    b.innerHTML = `<h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  toast(text, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    this.toasts.prepend(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
    while (this.toasts.childElementCount > 4) this.toasts.lastChild.remove();
  }

  hurtFlash() {
    const el = $('#hurt');
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
  }

  // ---------- modals ----------

  openModal(html) {
    this.modal.innerHTML = `<div class="sheet">${html}</div>`;
    this.modal.classList.remove('hidden');
    return this.modal.querySelector('.sheet');
  }

  closeModal() { this.modal.classList.add('hidden'); this.modal.innerHTML = ''; }

  showPactOffer(offers, done) {
    const sheet = this.openModal(`
      <div class="kicker">Between waves</div>
      <h2>Forge a Pact</h2>
      <p class="lede">Pacts are permanent once created. Give up something real and your Technique grows. An unmet condition means no enhancement, not punishment.</p>
      <div class="offers">${offers.map((p, i) => `
        <button class="offer ${p.shared ? 'shared' : ''}" data-i="${i}">
          <div class="kicker">${p.kind}</div>
          <h3>${p.name}</h3>
          <p>${p.text}</p>
          <div class="resolve">${p.shared ? 'Sacrifice already counted. Benefit at 15%, Resolve +0' : `Resolve +${p.resolve}`}</div>
          <kbd>${i + 1}</kbd>
        </button>`).join('')}
      </div>
      <button class="ghost" data-i="-1">Refuse all Pacts</button>`);
    const pick = (i) => { cleanup(); this.closeModal(); done(i >= 0 ? offers[i] : null); };
    const onKey = (e) => { const n = Number(e.key); if (n >= 1 && n <= offers.length) pick(n - 1); };
    const cleanup = () => window.removeEventListener('keydown', onKey);
    window.addEventListener('keydown', onKey);
    sheet.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => pick(Number(b.dataset.i))));
  }

  showEyeOffer(techKey, done) {
    const others = Object.keys(TECHNIQUES).filter((k) => k !== techKey);
    const vault = others[(Math.random() * others.length) | 0];
    const sheet = this.openModal(`
      <div class="kicker">Author secret</div>
      <h2>An Eye, offered in the rain</h2>
      <p class="lede">Five finite artifacts. Most people do not know they exist. Installing one permanently replaces one of your natural eyes. They are not Techniques.</p>
      <div class="offers eyes">${Object.entries(EYES).map(([k, e]) => `
        <button class="offer eye ${e.locked ? 'locked' : ''}" data-k="${k}" ${e.locked ? 'disabled' : ''} style="--c:${hex(e.color)}">
          <div class="art" style="background-image:url(${e.img})"></div>
          <h3>${e.name}</h3>
          <p>${e.text}${k === 'vault' ? ` <b>Housed: ${TECHNIQUES[vault].name}.</b>` : ''}</p>
        </button>`).join('')}
      </div>
      <button class="ghost" data-k="">Keep both natural eyes</button>`);
    sheet.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.k || null;
      this.closeModal();
      if (k) {
        $('#eye-loss').classList.remove('hidden');
        const he = $('#hud-eye');
        he.classList.remove('hidden');
        he.textContent = EYES[k].name + (k === 'vault' ? ` · ${TECHNIQUES[vault].name}` : '');
        he.style.color = hex(EYES[k].color);
        this.toast(`${EYES[k].name} installed. The natural eye is gone for good.`, 'gold');
      }
      done(k, k === 'vault' ? vault : null);
    }));
  }

  showDiscovery(done) {
    const sheet = this.openModal(`
      <div class="kicker">Discovery · formalized twenty years ago</div>
      <h2>Aurabending</h2>
      <p class="lede">A faculty separate from your Technique. It does not fuel it. For five thousand years nobody noticed it.</p>
      <div class="discovery">
        <p><kbd>F</kbd> <b>Aura Expansion</b>: hold to project your presence. Enemies inside your field move slower, act slower, take more damage, and their projectiles lose speed.</p>
        <p>When two fields meet, they <b>clash</b>. Hold your field and keep still to push. Attacking while you clash weakens your push, because sustaining a field while acting is hard. A field crushed back into its user breaks their guard.</p>
        <p class="note">Aura drains while expanded and recovers when withdrawn.</p>
      </div>
      <button class="primary">Continue</button>`);
    sheet.querySelector('button').addEventListener('click', () => { this.closeModal(); done(); });
  }

  showEnd(win, s) {
    const mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60).toString().padStart(2, '0');
    const sheet = this.openModal(`
      <div class="kicker">${win ? 'Victory' : 'Defeat'}</div>
      <h2>${win ? 'The roof falls silent' : 'Your Technique goes quiet'}</h2>
      <p class="lede">${win ? 'Five thousand years of mastery, and a Pact you made in the rain was enough.' : `You fell on wave ${s.wave}. Every Pact you made is still yours. That is how Pacts work.`}</p>
      <dl class="stats">
        <dt>Technique</dt><dd>${s.tech}</dd>
        <dt>Score</dt><dd>${s.score}</dd>
        <dt>Defeated</dt><dd>${s.kills}</dd>
        <dt>Resolve</dt><dd>${s.resolve}</dd>
        <dt>Wagers</dt><dd>${s.wagers}</dd>
        <dt>Eye</dt><dd>${s.eye ? EYES[s.eye].name : 'None'}</dd>
        <dt>Time</dt><dd>${mins}:${secs}</dd>
        <dt>Pacts</dt><dd>${s.pacts.join(', ') || 'None'}</dd>
      </dl>
      <button class="primary">Choose a Technique</button>`);
    sheet.querySelector('button').addEventListener('click', () => { this.closeModal(); this.onRestart?.(); });
  }

  showPause(onResume, onQuit) {
    const sheet = this.openModal(`
      <div class="kicker">Paused</div>
      <h2>Codex</h2>
      <dl class="codex">${CODEX.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="row"><button class="primary" data-a="resume">Resume</button><button class="ghost" data-a="quit">Abandon run</button></div>`);
    sheet.querySelector('[data-a=resume]').addEventListener('click', onResume);
    sheet.querySelector('[data-a=quit]').addEventListener('click', onQuit);
  }
}
