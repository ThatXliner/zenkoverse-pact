// The Aura Clash as rules (issue #4). The browser runs a referee for a clash
// against the Ancient Echo Master; server/realtime.mjs runs one for a clash
// between two players, so both screens show the outcome the server decided.
// Plain JavaScript so the server can import it; clash.d.ts types it for the
// client. The timings and margins are `clash` in rules.json.
//
// A clash is up to `rounds` exchanges. In each one both sides pick, hidden:
// push beats hold, hold beats feint, feint beats push. The same pick goes to
// the denser field when the gap is at least `tieMargin`, and to nobody
// otherwise. The first to `winAt` exchanges wins. When the rounds run out
// level, the denser field wins if the gap is at least `closeMargin`, and
// otherwise both fields break. A side that picks nothing in time holds.

export const PICKS = ['push', 'hold', 'feint'];
const BEATS = { push: 'hold', hold: 'feint', feint: 'push' };

export const isPick = (p) => PICKS.includes(p);
// The pick that beats `p`.
export const counterTo = (p) => PICKS.find((q) => BEATS[q] === p);

// One exchange: 0 or 1 for the side that took it, null for neither.
export function roundWinner(a, b, densityA, densityB, rules) {
  if (BEATS[a] === b) return 0;
  if (BEATS[b] === a) return 1;
  if (Math.abs(densityA - densityB) >= rules.tieMargin) return densityA > densityB ? 0 : 1;
  return null;
}

// Runs one clash on a millisecond clock that the caller supplies, so it plays
// the same in a browser frame loop and on the server's tick. `step` returns
// what happened since the last call, in order:
//   { kind: 'round', round, ms }            an exchange opens for `ms`
//   { kind: 'reveal', round, picks, winner, score }
//   { kind: 'end', winner, reason }         winner 0, 1 or null (both break)
export class ClashReferee {
  constructor(density, rules, now) {
    this.density = density;
    this.rules = rules;
    this.stage = 'intro';
    this.until = now + rules.introMs;
    this.round = 0;
    this.score = [0, 0];
    this.picks = [null, null];
    this.winner = undefined;
  }

  get over() { return this.stage === 'over'; }

  // Accepts the first pick a side makes in an open exchange.
  pick(side, pick, now) {
    if (this.stage !== 'choose' || now > this.until || !isPick(pick) || this.picks[side]) return false;
    this.picks[side] = pick;
    return true;
  }

  step(now) {
    const out = [];
    for (;;) {
      if (this.stage === 'intro' && now >= this.until) this.open(now, out);
      else if (this.stage === 'choose' && (now >= this.until || (this.picks[0] && this.picks[1]))) this.reveal(now, out);
      else if (this.stage === 'reveal' && now >= this.until) this.next(now, out);
      else return out;
    }
  }

  // A side left mid-clash: it loses.
  forfeit(side) {
    if (this.over) return [];
    return [this.finish(1 - side, 'forfeit')];
  }

  open(now, out) {
    this.round++;
    this.picks = [null, null];
    this.stage = 'choose';
    this.until = now + this.rules.windowMs;
    out.push({ kind: 'round', round: this.round, ms: this.rules.windowMs });
  }

  reveal(now, out) {
    const picks = [this.picks[0] ?? 'hold', this.picks[1] ?? 'hold'];
    const winner = roundWinner(picks[0], picks[1], this.density[0], this.density[1], this.rules);
    if (winner !== null) this.score[winner]++;
    this.stage = 'reveal';
    this.until = now + this.rules.revealMs;
    out.push({ kind: 'reveal', round: this.round, picks, winner, score: [...this.score] });
  }

  next(now, out) {
    const [a, b] = this.score, { winAt, rounds, closeMargin } = this.rules;
    if (a >= winAt || b >= winAt) { out.push(this.finish(a > b ? 0 : 1, 'rounds')); return; }
    if (this.round < rounds) { this.open(now, out); return; }
    if (a !== b) { out.push(this.finish(a > b ? 0 : 1, 'rounds')); return; }
    const gap = this.density[0] - this.density[1];
    out.push(Math.abs(gap) >= closeMargin ? this.finish(gap > 0 ? 0 : 1, 'density') : this.finish(null, 'even'));
  }

  finish(winner, reason) {
    this.stage = 'over';
    this.winner = winner;
    return { kind: 'end', winner, reason };
  }
}
