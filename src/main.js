import { createWorld } from './world.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Game } from './game.js';
import { initAudio, setMuted } from './audio.js';

const canvas = document.getElementById('c');
const world = createWorld(canvas);
const input = new Input(canvas, world.camera);
const ui = new UI();
const game = new Game(world, input, ui);

const toTitle = () => {
  game.clearArena();
  game.player = null;
  game.state = 'title';
  ui.showTitle((key) => { initAudio(); game.start(key); });
};
ui.onRestart = toTitle;
toTitle();
if (new URLSearchParams(location.search).has('debug')) game.enableDebug();

let muted = false;
document.getElementById('mute').addEventListener('click', (e) => {
  muted = !muted;
  setMuted(muted);
  e.target.textContent = `Sound: ${muted ? 'off' : 'on'}`;
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (game.state === 'playing') {
    game.state = 'paused';
    ui.showPause(() => { ui.closeModal(); game.state = 'playing'; }, () => { ui.closeModal(); toTitle(); });
  } else if (game.state === 'paused') {
    ui.closeModal();
    game.state = 'playing';
  }
});

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  world.composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
