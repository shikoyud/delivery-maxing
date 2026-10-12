import './ui/styles.css';
import { Game } from './game/Game';
import { parseMapKind } from './game/mapLoader';

const host = document.getElementById('app');
const hint = document.getElementById('play-hint');
const bootError = document.getElementById('boot-error');
const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : undefined;

if (!host) throw new Error('#app is missing');

// Inside the promise chain, so a bad ?map= value is reported like any other start failure.
Promise.resolve()
  .then(() => Game.create(host, { debug, seed, map: parseMapKind(params.get('map')) }))
  .then((game) => {
    game.start();
    if (hint && !debug) {
      const update = (): void => {
        hint.hidden = game.input.locked || game.delivery.modalOpen;
      };
      document.addEventListener('pointerlockchange', update);
      game.delivery.onModalChange(update);
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
