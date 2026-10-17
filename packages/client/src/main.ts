import './ui/styles.css';
import { Game } from './game/Game';
import { parseMapKind } from './game/mapLoader';
import { runPerf } from './game/perf';
import { perfConfig } from './clientConfig';
import { playHintHidden } from './ui/playHint';

const host = document.getElementById('app');
const hint = document.getElementById('play-hint');
const bootError = document.getElementById('boot-error');
const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : undefined;
const map = parseMapKind(params.get('map'));
// ?perf=1 runs the flythrough (config/perf.json) and shows its result panel; &seconds=N shortens it (5 for a quick check).
// Its route is over the city, so on the greybox it is ignored.
const perfAsked = params.get('perf') === '1';
const perf = perfAsked && map === 'city';
if (perfAsked && !perf) console.warn(`?perf=1 only runs on the city map; ignored on ?map=${map}`);
const perfSeconds = Number.parseFloat(params.get('seconds') ?? '');

if (!host) throw new Error('#app is missing');

Game.create(host, { debug, seed, map })
  .then((game) => {
    game.start();
    if (perf) {
      if (hint) hint.hidden = true;
      const seconds = perfSeconds > 0 ? perfSeconds : perfConfig.seconds;
      runPerf(game, { ...perfConfig, seconds })
        .then((result) => {
          game.perfResult = result;
        })
        .catch(() => undefined); // runPerf has already logged the error and shown it in the panel
    } else if (hint && !debug) {
      const update = (): void => {
        hint.hidden = playHintHidden({ locked: game.input.locked, phoneOpen: game.delivery.phoneOpen || game.delivery.mapOpen });
      };
      document.addEventListener('pointerlockchange', update);
      game.onPhoneChanged = update;
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
