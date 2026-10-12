import './ui/styles.css';
import { Game } from './game/Game';

const host = document.getElementById('app');
const hint = document.getElementById('play-hint');
const bootError = document.getElementById('boot-error');
const debug = new URLSearchParams(window.location.search).has('debug');

if (!host) throw new Error('#app is missing');

Game.create(host, { debug })
  .then((game) => {
    game.start();
    if (hint && !debug) {
      const update = (): void => {
        hint.hidden = game.input.locked;
      };
      document.addEventListener('pointerlockchange', update);
      update();
    }
  })
  .catch((err: unknown) => {
    console.error(err);
    if (bootError) {
      bootError.textContent = `The game could not start: ${err instanceof Error ? err.message : String(err)}`;
      bootError.hidden = false;
    }
  });
