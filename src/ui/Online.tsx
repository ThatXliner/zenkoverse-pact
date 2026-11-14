import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../app/game';
import { toast } from '../app/game';
import { netUi, savedName, saveName, roomFromUrl, cleanRoom } from '../net/net';
import { seatSuit } from '../net/remote';
import { RULES } from '../net/protocol';
import { KITS } from '../techniques/techniques';
import type { TechniqueId } from '../pacts/schema';
import './online.css';

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

// The foot of the Technique screen when the player came in through Play
// Online or a room link: a name, the room, and the way in.
export function OnlineJoin({ game, tech, onBack }: { game: Game; tech: TechniqueId; onBack: () => void }) {
  const [name, setName] = useState(savedName());
  const [room, setRoom] = useState(roomFromUrl() ?? RULES.defaultRoom);
  const join = () => {
    const n = name.trim() || 'Student';
    saveName(n);
    game.setTechnique(tech);
    game.startOnline(cleanRoom(room), n);
  };
  return (
    <form class="online-join" onSubmit={(e) => { e.preventDefault(); join(); }}>
      <label><span class="kicker">Name</span><input name="name" value={name} maxLength={20} placeholder="Student" autoComplete="nickname" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <label><span class="kicker">Room</span><input name="room" value={room} maxLength={24} placeholder={RULES.defaultRoom} onInput={(e) => setRoom((e.target as HTMLInputElement).value)} /></label>
      <button type="button" class="btn" onClick={onBack}>Back</button>
      <button type="submit" class="btn primary" data-join>Enter the room</button>
    </form>
  );
}

export function copyRoomLink(): void {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('room', netUi.room.value);
  void navigator.clipboard?.writeText(url.toString()).then(() => toast('Room link copied.', 'good'), () => toast(url.toString()));
}

// Online pause menu: the world keeps running behind it.
export function OnlineMenu({ game, back }: { game: Game; back: () => void }) {
  return (
    <div class="pause-menu">
      <button onClick={back}>Resume</button>
      <button onClick={copyRoomLink}>Copy room link</button>
      <button onClick={() => game.leaveOnline()}>Leave the room</button>
      <p class="online-note">The room does not pause. You can still be hit while this menu is open.</p>
    </div>
  );
}

// Everything online adds to the HUD: names over the other players, the
// scoreboard, the feed of downs and arrivals, the connection, and the
// downed card.
export function OnlineHud({ game }: { game: Game }) {
  const me = netUi.me.value;
  const status = netUi.status.value;
  const rows = [...(me ? [me] : []), ...netUi.others.value].sort((a, b) => b.kills - a.kills || a.downs - b.downs || a.id - b.id);
  return (
    <>
      <div class="plates" aria-hidden="true">
        {netUi.plates.value.map((p) => (
          <div key={p.id} class={`plate ${p.down ? 'down' : ''} ${p.away ? 'away' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%`, '--c': p.color } as never}>
            <span class="n">{p.name}{p.away ? ' · away' : ''}</span>
            <div class="hp"><i style={{ width: `${Math.max(0, Math.min(1, p.hp)) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <div class="scoreboard" data-room={netUi.room.value}>
        <header>
          <span class="kicker">Room {netUi.room.value}</span>
          <span class={`conn ${status}`}>{status === 'online' ? `${netUi.ping.value} ms` : status === 'reconnecting' ? 'Reconnecting' : status === 'connecting' ? 'Connecting' : status === 'full' ? 'Room full' : ''}</span>
        </header>
        <ol>
          {rows.map((p) => (
            <li key={p.id} class={p.id === me?.id ? 'me' : ''} data-player={p.id}>
              <i style={{ background: hex(seatSuit(p.slot)) }} />
              <span class="n">{p.name}</span>
              <span class="t">{KITS[p.tech as TechniqueId]?.name ?? ''}</span>
              <span class="k" title="Downs dealt">{p.kills}</span>
              <span class="d" title="Times downed">{p.downs}</span>
            </li>
          ))}
        </ol>
      </div>
      <div class="feed">{netUi.feed.value.map((f) => <div key={f.id}>{f.text}</div>)}</div>
      <Downed />
      {status === 'full' && <div class="downed"><div><div class="jp">満室</div><p>This room is full.</p><button class="btn" onClick={() => game.leaveOnline()}>Back to the title</button></div></div>}
    </>
  );
}

function Downed() {
  const d = netUi.downed.value;
  const [, setTick] = useState(0);
  useEffect(() => { if (!d) return; const t = setInterval(() => setTick((n) => n + 1), 200); return () => clearInterval(t); }, [d]);
  if (!d) return null;
  const left = Math.max(0, RULES.respawnSeconds - (performance.now() - d.at) / 1000);
  return (
    <div class="downed" data-downed>
      <div>
        <div class="jp">倒</div>
        <p>{d.by ? `${d.by} downed you.` : 'You went down.'}</p>
        <p class="s">Back on your feet in {left.toFixed(0)}</p>
      </div>
    </div>
  );
}
