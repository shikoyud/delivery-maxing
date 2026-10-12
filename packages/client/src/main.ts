import './ui/styles.css';
import { Game } from './game/Game';
import { parseMapKind } from './game/mapLoader';
import { runPerf } from './game/perf';

const host = document.getElementById('app');
const hint = document.getElementById('play-hint');
const bootError = document.getElementById('boot-error');
const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : undefined;
// ?perf=1 runs the flythrough (on the city unless ?map= says otherwise); ?perfSeconds=N shortens it (the e2e uses 5).
const perf = params.get('perf') === '1';
const perfSeconds = Number.parseFloat(params.get('perfSeconds') ?? '');

if (!host) throw new Error('#app is missing');

// Inside the promise chain, so a bad ?map= value is reported like any other start failure.
Promise.resolve()
  .then(() => Game.create(host, { debug, seed, map: parseMapKind(params.get('map') ?? (perf ? 'city' : null)) }))
  .then((game) => {
    game.start();
    if (perf) {
      const seconds = perfSeconds > 0 ? perfSeconds : game.cfg.perf.seconds;
      void runPerf(game, { ...game.cfg.perf, seconds }).then((result) => {
        game.perfResult = result;
      });
    } else if (hint && !debug) {
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
