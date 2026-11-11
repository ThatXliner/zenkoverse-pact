import type { ComponentChildren } from 'preact';
import { type Param, type Restriction, PARAM_VALUES } from '../pacts/schema';
import { describe, type ResolveLine } from '../pacts/resolve';

// One picker per Pact parameter. Every picker shows all of its alternatives
// at once, each with the words the readback will use and what it is worth
// to this player, so a choice is made against what it trades.

export interface PickerProps {
  param: Param;
  value: string | undefined;
  weigh(value: string): ResolveLine;
  onPick(value: string): void;
}

export const PARAM_WORDS: Record<Param, { title: string; hint: string }> = {
  direction: { title: 'Direction', hint: 'where it works' },
  range: { title: 'Range', hint: 'how far it reaches' },
  target: { title: 'Target', hint: 'what it may touch' },
  trigger: { title: 'Trigger', hint: 'when it may fire' },
  duration: { title: 'Duration', hint: 'how long it lasts' },
  resource: { title: 'Resource', hint: 'what each use costs' },
  body: { title: 'Body', hint: 'what you give of yourself' },
};

export const PARAM_COLOR: Record<Param | 'clause', string> = {
  direction: '#f2a65a', range: '#7dc4ff', target: '#c6a8ff', trigger: '#ffd34d', duration: '#7dffb2', resource: '#ff6b6b', body: '#ff8fb1', clause: '#d8d2c4',
};

const GLYPH: Record<string, string> = {
  'trigger:still': '静', 'trigger:grounded': '地', 'trigger:airborne': '空', 'trigger:struck': '被', 'trigger:eyesClosed': '閉', 'trigger:declared': '宣', 'trigger:lowHealth': '瀕', 'trigger:fullSign': '印',
  'target:single': '一', 'target:named': '名', 'target:resonant': '響', 'target:water': '水', 'target:self': '己', 'target:props': '物', 'target:people': '人',
  'resource:all': '全', 'resource:half': '半', 'resource:health': '血', 'resource:strain': '疲',
};

export function Worth({ line }: { line: ResolveLine }) {
  if (line.zero) return <span class="w zero" title={line.reason}>paid by {line.by}</span>;
  if (line.warn) return <span class="w warn" title={line.reason}>+{line.value.toFixed(1)}, rarely a cost</span>;
  return <span class="w" title={line.reason}>+{line.value.toFixed(1)}</span>;
}

function Option({ on, onClick, children, cls }: { on: boolean; onClick(): void; children: ComponentChildren; cls?: string }) {
  return <button class={`opt ${on ? 'on' : ''} ${cls ?? ''}`} aria-pressed={on} onClick={onClick}>{children}</button>;
}

const words = (param: Param, value: string) => describe({ param, value } as Restriction);

function LineOptions({ param, value, weigh, onPick, cls }: PickerProps & { cls: string }) {
  return (
    <div class={`opts ${cls}`}>
      {PARAM_VALUES[param].map((v) => (
        <Option key={v} on={v === value} onClick={() => onPick(v)} cls="line">
          <span class="l">{words(param, v)}</span>
          <Worth line={weigh(v)} />
        </Option>
      ))}
    </div>
  );
}

function GlyphTiles({ param, value, weigh, onPick }: PickerProps) {
  return (
    <div class="opts tiles four">
      {PARAM_VALUES[param].map((v) => (
        <Option key={v} on={v === value} onClick={() => onPick(v)} cls="glyph">
          <span class="g">{GLYPH[`${param}:${v}`] ?? ''}</span>
          <span class="l">{words(param, v)}</span>
          <Worth line={weigh(v)} />
        </Option>
      ))}
    </div>
  );
}

// Top-down figure with the covered region per option.
function DirectionTiles({ param, value, weigh, onPick }: PickerProps) {
  const figure = <g><circle cx="40" cy="40" r="7" fill="currentColor" /><path d="M28 48 L52 48" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></g>;
  const art: Record<string, ComponentChildren> = {
    front: <path d="M40 40 L10 6 A45 45 0 0 1 70 6 Z" class="zone" />,
    behind: <path d="M40 40 L10 74 A45 45 0 0 0 70 74 Z" class="zone" />,
    ground: <g><ellipse cx="40" cy="44" rx="34" ry="12" class="zone" /><path d="M6 44 L74 44" stroke="currentColor" stroke-width="1" stroke-dasharray="3 3" /></g>,
    line: <path d="M37 40 L37 4 L43 4 L43 40 Z" class="zone" />,
    declared: <g><path d="M40 40 L64 14" stroke="currentColor" stroke-width="2" stroke-dasharray="4 3" /><path d="M64 14 L52 16 M64 14 L62 26" stroke="currentColor" stroke-width="2" /><text x="10" y="20" font-size="14" fill="currentColor" font-family="var(--serif)">?</text></g>,
  };
  return (
    <div class="opts tiles five">
      {PARAM_VALUES[param].map((v) => (
        <Option key={v} on={v === value} onClick={() => onPick(v)} cls="art">
          <svg viewBox="0 0 80 80" width="64" height="64" aria-hidden="true">{art[v]}{figure}</svg>
          <span class="l">{words(param, v)}</span>
          <Worth line={weigh(v)} />
        </Option>
      ))}
    </div>
  );
}

// Concentric rings around the player; the chosen ring is the reach.
function RangeRings(props: PickerProps) {
  const radii: Record<string, number> = { touch: 12, short: 30, medium: 52, long: 76 };
  return (
    <div class="diagram">
      <svg viewBox="0 0 170 160" width="170" height="160" aria-hidden="true">
        {[...PARAM_VALUES.range].reverse().map((v) => <circle key={v} cx="85" cy="80" r={radii[v]} class={`ring ${v === props.value ? 'on' : ''}`} onClick={() => props.onPick(v)} />)}
        <circle cx="85" cy="80" r="5" fill="currentColor" />
      </svg>
      <LineOptions {...props} cls="list" />
    </div>
  );
}

// A timeline: each option is how long the effect holds after the cast.
function DurationTimeline({ param, value, weigh, onPick }: PickerProps) {
  const bars: Record<string, { w: number; hand?: boolean }> = { instant: { w: 6 }, brief: { w: 36 }, held: { w: 80, hand: true }, sustained: { w: 140 } };
  return (
    <div class="opts list two">
      {PARAM_VALUES[param].map((v) => (
        <Option key={v} on={v === value} onClick={() => onPick(v)} cls="timeline">
          <svg viewBox="0 0 150 20" width="150" height="20" aria-hidden="true">
            <path d="M2 10 L148 10" stroke="currentColor" stroke-opacity="0.2" stroke-width="1" />
            <rect x="2" y="5" width={bars[v]!.w} height="10" class="zone" />
            {bars[v]!.hand && <text x={bars[v]!.w + 8} y="15" font-size="12" fill="currentColor" font-family="var(--serif)">手</text>}
          </svg>
          <span class="l">{words(param, v)}</span>
          <Worth line={weigh(v)} />
        </Option>
      ))}
    </div>
  );
}

// A body diagram: each option is a place on the figure.
function BodyDiagram(props: PickerProps) {
  const spots: Record<string, { x: number; y: number }> = {
    eyes: { x: 50, y: 17 }, voice: { x: 50, y: 31 }, maxHealth: { x: 46, y: 56 }, bothHands: { x: 16, y: 92 }, palmContact: { x: 84, y: 92 },
    noMove: { x: 50, y: 104 }, noDash: { x: 80, y: 134 }, barefoot: { x: 50, y: 160 },
  };
  return (
    <div class="diagram">
      <svg viewBox="0 0 100 172" width="100" height="172" aria-hidden="true">
        <circle cx="50" cy="19" r="11" class="limb" />
        <path d="M50 30 L50 39 M36 41 Q50 36 64 41 L62 94 L38 94 Z" class="limb" />
        <path d="M36 43 L20 86 M64 43 L80 86" class="limb" />
        <path d="M42 94 L38 160 M58 94 L62 160" class="limb" />
        <path d="M76 100 L92 100" stroke="currentColor" stroke-opacity="0.5" stroke-width="2" />
        {Object.entries(spots).map(([v, p]) => (
          <g key={v} class={`spot ${v === props.value ? 'on' : ''}`} onClick={() => props.onPick(v)}><circle cx={p.x} cy={p.y} r="8" /></g>
        ))}
      </svg>
      <LineOptions {...props} cls="list two" />
    </div>
  );
}

export const PICKERS: Record<Param, (p: PickerProps) => ComponentChildren> = {
  direction: DirectionTiles,
  range: RangeRings,
  target: GlyphTiles,
  trigger: GlyphTiles,
  duration: DurationTimeline,
  resource: GlyphTiles,
  body: BodyDiagram,
};

export function TermPicker(props: PickerProps) {
  const Picker = PICKERS[props.param];
  return <>{Picker(props)}</>;
}
