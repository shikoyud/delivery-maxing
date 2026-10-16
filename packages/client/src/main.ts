import './ui/styles.css';
import { Game } from './game/Game';
import { parseMapKind } from './game/mapLoader';
import { playHintHidden } from './ui/playHint';

const host = document.getElementById('app');
const hint = document.getElementById('play-hint');
const bootError = document.getElementById('boot-error');
const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isFinite(seedParam) ? seedParam : undefined;
const map = parseMapKind(params.get('map'));

if (!host) throw new Error('#app is missing');

Game.create(host, { debug, seed, map })
  .then((game) => {
    game.start();
    if (hint && !debug) {
      const update = (): void => {
        hint.hidden = playHintHidden({ locked: game.input.locked, phoneOpen: game.delivery.phoneOpen });
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
