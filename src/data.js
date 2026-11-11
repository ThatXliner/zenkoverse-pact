// Game content drawn from the Zenkoverse power-system wiki.

export const TECHNIQUES = {
  recoil: {
    name: 'Recoil',
    type: 'Manipulation · Energy family',
    color: 0xff7a2f,
    img: 'img/recoil.jpg',
    blurb: 'Take in kinetic energy, store it, release it later as motion. Energy never disappears: every softened blow is a debt.',
    resource: 'Reserve',
    controls: [
      ['LMB', 'Kinetic Release: a strike powered by your Reserve'],
      ['RMB (hold)', 'Absorption: frontal hits fill your Reserve instead of hurting you'],
      ['Q', 'Zero Hour: dump all stored energy in one declared motion'],
    ],
    note: 'Over capacity, absorbed energy becomes heat inside your body.',
  },
  shift: {
    name: 'Shift',
    type: 'Spatial',
    color: 0x6fd3ff,
    img: 'img/shift.jpg',
    blurb: 'Translate your body through whatever lies between. Momentum and orientation are preserved, so every use is geometry.',
    resource: 'Focus',
    controls: [
      ['LMB', 'Displacement Strike: an aura-coated close arc'],
      ['RMB', 'Shift: translate to the cursor, through pillars and foes'],
      ['Q', 'Long Translation: a line-crossing displacement that cuts through everything on it'],
    ],
    note: 'Arriving at speed carries your momentum into the next strike.',
  },
  rime: {
    name: 'Rime',
    type: 'Generation / Manipulation',
    color: 0x9fe8ff,
    img: 'img/rime.jpg',
    blurb: 'Nucleate water through your fingernails. Tonight it is raining, so there is a great deal of water.',
    resource: 'Frost strain',
    controls: [
      ['LMB', 'Icebreak: a growing ridge of spikes that advances along the wet ground'],
      ['RMB', 'Cold Stitch: freeze the area at the cursor and pin anyone in it'],
      ['Q', 'Tenfold Glacier: all ten nail beds at once. You cannot move while it spreads'],
    ],
    note: 'Freezing removes heat from your hands. Past full strain, every cast costs health.',
  },
  blink: {
    name: 'Blink',
    type: 'Manifestation',
    color: 0xc6a8ff,
    img: 'img/blink.jpg',
    blurb: 'Close both eyes and a concussive pulse leaves your tear ducts. It cannot curve and it cannot fire anywhere but forward.',
    resource: 'Tears',
    controls: [
      ['LMB', 'Flinch: a forward pressure cone'],
      ['RMB', 'Doubletake: blink at the ground to launch yourself backward'],
      ['Q', 'Eyes Shut: empty both glands. You go briefly blind'],
    ],
    note: 'Staring Contest is built in: every second you don\'t blink strengthens the next pulse.',
  },
  echo: {
    name: 'Echo',
    type: 'Manipulation',
    color: 0x7dffb2,
    img: 'img/echo.jpg',
    blurb: 'Manipulate mechanical vibration through connected matter. Air is matter too. The strongest effects come from resonance.',
    resource: 'Phase',
    controls: [
      ['LMB', 'Ring: a wave that adds Resonance to whatever it touches. Five stacks shatters'],
      ['RMB (hold)', 'Quiet: active cancellation erases incoming projectiles'],
      ['Q', 'Cathedral Resonance: force the whole rooftop into one mode. You share the vibration'],
    ],
    note: 'Resonance breaks if you change targets too slowly. Keep the phase.',
  },
};

// Each Pact is a real sacrifice. `tag` identifies the sacrifice so that two Pacts
// built on the same surrender share its value (anti-loophole rule).
export const PACTS = [
  { id: 'rooted', tag: 'stillness', name: 'Rooted Vow', kind: 'Condition', resolve: 3,
    text: 'While you stand still: +60% output.', mult: 0.6, cond: 'still' },
  { id: 'stance', tag: 'stillness', name: 'Unmoving Stance', kind: 'Condition', resolve: 3,
    text: 'While you stand still: +50% output.', mult: 0.5, cond: 'still' },
  { id: 'close', tag: 'range', name: 'Arm\'s Length', kind: 'Condition', resolve: 2,
    text: 'Against targets within 7m: +70% output. Beyond that, nothing.', mult: 0.7, cond: 'close' },
  { id: 'glass', tag: 'body', name: 'Glass Vow', kind: 'Permanent sacrifice', resolve: 4,
    text: 'Max health permanently -35%. Output permanently +40%.', mult: 0.4, cond: 'always', apply: 'glass' },
  { id: 'sunset', tag: 'time', name: 'Sunset Clause', kind: 'Duration', resolve: 1,
    text: '+55% output for the next wave only. The Pact remains; its term ends.', mult: 0.55, cond: 'sunset' },
  { id: 'silence', tag: 'mobility', name: 'Grounded Silence', kind: 'Restriction', resolve: 3,
    text: 'You can never dash again. Output +35%.', mult: 0.35, cond: 'always', apply: 'nodash' },
  { id: 'named', tag: 'targeting', name: 'Named Target', kind: 'Restriction', resolve: 3,
    text: 'Each wave one enemy is Named. It takes +120%. Everyone else takes -40% until it falls.', mult: 1.2, cond: 'named' },
  { id: 'lastbreath', tag: 'health', name: 'Last Breath', kind: 'Condition', resolve: 2,
    text: 'Below 35% health: +80% output.', mult: 0.8, cond: 'low' },
  { id: 'overext', tag: 'risk-max', name: 'Overextension', kind: 'Risk', resolve: 2,
    text: 'Max Output may fire from 50% charge. Doing so costs 25% of your health.', mult: 0, cond: 'never', apply: 'overext' },
  { id: 'overdraw', tag: 'risk-res', name: 'Blood Draw', kind: 'Risk', resolve: 2,
    text: 'When your resource runs dry, keep casting. Each cast costs health instead.', mult: 0, cond: 'never', apply: 'overdraw' },
  { id: 'blindbet', tag: 'wager', name: 'Blind Betting', kind: 'Wager', resolve: 3,
    text: 'Wagers pay x4 instead of x3. A lost Wager seals your Technique for 7s instead of 4s.', mult: 0, cond: 'never', apply: 'blindbet' },
  { id: 'riposte', tag: 'program', name: 'Programmed Riposte', kind: 'Programming', resolve: 2,
    text: 'IF struck THEN release a counter-pulse automatically. Dash cooldown doubles.', mult: 0, cond: 'never', apply: 'riposte' },
  { id: 'facing', tag: 'direction', name: 'Facing Vow', kind: 'Condition', resolve: 1,
    text: 'Only targets in your front 50° cone: +30% output.', mult: 0.3, cond: 'facing' },
];

export const EYES = {
  horizon: { name: 'Horizon Eye', color: 0xffb347, img: 'img/eye-horizon.jpg',
    text: 'Perceive reachable futures. Enemy attacks and projectile paths are shown before they arrive. A novice sees only that many branches end badly.' },
  empty: { name: 'Empty Eye', color: 0xb7c3d6, img: 'img/eye-empty.jpg',
    text: 'Perceive absence and concealment. Veiled enemies are fully revealed and take +40% from you. Hidden shields show their gaps.' },
  thread: { name: 'Thread Eye', color: 0xff5fa2, img: 'img/eye-thread.jpg',
    text: 'Perceive dependencies. See the threads between a Pact Architect and the allies it sustains; damage to an anchor travels down every thread.' },
  vault: { name: 'Vault Eye', color: 0x8affd6, img: 'img/eye-vault.jpg',
    text: 'House one transferred foreign Technique, never a copy. Press E to use a second Technique\'s primary Ability.' },
  covenant: { name: 'Covenant Eye', color: 0xe9e3ff, img: 'img/eye-covenant.jpg', locked: true,
    text: 'A universe-enforced binding vow between multiple willing people. You are fighting alone tonight. It cannot be installed.' },
};

export const ENEMIES = {
  bristle: { name: 'Bristle Brawler', hp: 60, speed: 5.2, radius: 0.7, color: 0xff4d5e, suit: 0x5a3040, dmg: 12, ai: 'melee', score: 10 },
  quill: { name: 'Quill Slinger', hp: 42, speed: 3.6, radius: 0.6, color: 0xffd34d, suit: 0x5a4e2a, dmg: 9, ai: 'ranged', score: 12 },
  soot: { name: 'Soot Lurker', hp: 50, speed: 4.4, radius: 0.65, color: 0x8d8da8, suit: 0x23232e, dmg: 14, ai: 'lurker', veiled: true, score: 15 },
  husk: { name: 'Husk Shell', hp: 130, speed: 2.6, radius: 1.0, color: 0xd8cfb8, suit: 0x6a6458, dmg: 18, ai: 'tank', shell: true, score: 20 },
  spring: { name: 'Spring Leaper', hp: 55, speed: 3.4, radius: 0.65, color: 0x6fe36b, suit: 0x2f5a36, dmg: 20, ai: 'leaper', score: 15 },
  architect: { name: 'Pact Architect', hp: 80, speed: 2.4, radius: 0.75, color: 0xb36bff, suit: 0x3e2a5e, dmg: 0, ai: 'architect', score: 25 },
  kuroda: { name: 'Kuroda Enforcer', hp: 720, speed: 3.4, radius: 1.1, color: 0xff6a1a, suit: 0x4a1e14, dmg: 16, ai: 'kuroda', boss: true, score: 120,
    title: 'Kuroda Enforcer — "fire" that is really fuel' },
  ancient: { name: 'The Ancient Echo Master', hp: 1500, speed: 3.0, radius: 1.3, color: 0x7dffb2, suit: 0x1c2e2a, skin: 0xe6d3c4, dmg: 22, ai: 'ancient', boss: true, score: 400,
    title: 'The Ancient Echo Master' },
};

export const WAVES = [
  { title: 'Academy Exam', spawns: { bristle: 4 } },
  { title: 'Rooftop Ambush', spawns: { bristle: 3, quill: 3 } },
  { title: 'Ledger Contract', spawns: { quill: 3, soot: 2, spring: 2 } },
  { title: 'The Kuroda Lineage', spawns: { kuroda: 1, bristle: 3 } },
  { title: 'Programmed Assault', spawns: { architect: 1, husk: 2, bristle: 3, quill: 2 } },
  { title: 'Underworld Crew', spawns: { soot: 3, spring: 3, quill: 3, husk: 1 } },
  { title: 'Clan Retaliation', spawns: { architect: 2, bristle: 4, soot: 2, spring: 2, husk: 2 } },
  { title: 'Five Thousand Years', spawns: { ancient: 1 } },
];

export const CODEX = [
  ['Technique', 'A person\'s underlying, unique supernatural capability. Everyone has one, usually exactly one. Most are weak, narrow, or useful outside combat.'],
  ['Pact', 'A restriction, condition, or sacrifice that modifies how your Technique operates. Pacts are permanent once created. An unmet condition means no enhancement, not punishment.'],
  ['Resolve', 'The real capability surrendered, not emotional intensity. The same sacrifice cannot be counted twice: five stationary Pacts share the value of being stationary.'],
  ['Risk', 'A deliberately designed escape clause. The enhanced effect continues outside its normal limit, and you pay the consequence.'],
  ['Wager', 'Declare an uncertain outcome. Success grants an enlarged reward; failure applies the forfeit. Press R to declare that your next attack will connect.'],
  ['Programming', 'Sophisticated Pact logic: triggers, routines, autonomous execution. Not a separate magic. Pact Architects use it to sustain allies.'],
  ['Maximum Output', 'The greatest concentrated expression of a Technique: everything you can presently commit, in one formulation.'],
  ['Eyes', 'Five finite physical artifacts. Installing one permanently replaces a natural eye. They are not Techniques and most people do not know they exist.'],
  ['Aurabending', 'A separate universal faculty, formalized only twenty years ago despite five thousand years of Technique history. Aura does not fuel Techniques.'],
  ['Aura Expansion', 'Projected presence carrying density, pressure, and intent. Inside a dominant field, opponents struggle to act. Two fields meeting become an Aura Clash.'],
];
