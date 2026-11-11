import { render, h } from 'preact';
import { Game } from './app/game';
import { App } from './ui/App';
import './ui/styles.css';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const game = new Game(canvas);
render(h(App, { game }), document.getElementById('ui')!);
void game.boot();
