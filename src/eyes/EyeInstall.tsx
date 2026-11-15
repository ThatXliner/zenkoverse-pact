import { useEffect } from 'preact/hooks';
import { EYES, EYE_SIDE } from './registry';
import { eyeUi } from './ui';
import './eyes.css';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
// Matches the length of the keyframes in eyes.css.
const LENGTH_MS = 2700;

// The installation, as a few panels' worth of drawing over the frame: the
// lids come down, and in the dark only one eye opens again, in the Eye's
// colour. Then the lids part on the fight, that side still washed with it.
// Any key or click ends it.
export function EyeInstall() {
  const it = eyeUi.installing.value;
  useEffect(() => {
    if (!it) return;
    const end = () => { if (eyeUi.installing.value?.n === it.n) eyeUi.installing.value = null; };
    const t = setTimeout(end, LENGTH_MS);
    // Listening starts a beat late, so the key that chose the Eye does not also skip it.
    const skip = (e: Event) => { e.preventDefault(); e.stopPropagation(); end(); };
    const arm = setTimeout(() => { window.addEventListener('keydown', skip, true); }, 250);
    return () => { clearTimeout(t); clearTimeout(arm); window.removeEventListener('keydown', skip, true); };
  }, [it?.n]);
  if (!it) return null;
  const e = EYES[it.id];
  return (
    <div class={`eye-install ${EYE_SIDE}`} key={it.n} style={{ '--c': hex(e.color) } as never} role="presentation" data-eye={it.id}
      onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); eyeUi.installing.value = null; }}>
      <div class="lid top" />
      <div class="lid bottom" />
      <div class="dark">
        <div class="seam" />
        <div class="iris"><i /></div>
        <div class="name"><span class="jp">{e.jp}</span><small>{e.name} · {EYE_SIDE} eye</small></div>
      </div>
      <div class="wash" />
    </div>
  );
}
