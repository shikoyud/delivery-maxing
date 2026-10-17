import { clientConfig, type BindingName } from '../../clientConfig';
import { el, keyLabel } from '../dom';

type ClientBindings = Record<BindingName, string[]>;

export type StubAppName = 'shop' | 'wardrobe' | 'leaderboard' | 'settings';

/** Apps that are placeholders this sub-project: their name and the sub-project that brings them. */
export const STUB_APPS: Record<StubAppName, { title: string; sp: number }> = {
  shop: { title: 'Shop', sp: 6 },
  wardrobe: { title: 'Wardrobe', sp: 6 },
  leaderboard: { title: 'Leaderboard', sp: 7 },
  settings: { title: 'Settings', sp: 3 },
};

const BINDING_LABEL: Record<BindingName, string> = {
  forward: 'Forward',
  back: 'Back',
  left: 'Left',
  right: 'Right',
  jump: 'Jump',
  crouch: 'Crouch',
  sprint: 'Sprint (toggle)',
  interact: 'Interact',
  hit: 'Hit',
  phone: 'Phone',
  map: 'Map view',
  accept: 'Accept top offer',
  mount: 'Mount',
  devPanel: 'Dev panel',
  debugOverlay: 'Debug overlay',
  mapDebug: 'Map debug view',
};

/** "App name" and "Coming in SP{n}" in `root`; a placeholder with that copy also serves the Map tab until Task 11. */
export function buildComingSoon(root: HTMLElement, title: string, sp: number): HTMLElement {
  const wrap = el('div', 'phone-stub', root);
  el('h3', 'phone-stub-title', wrap).textContent = title;
  el('p', 'phone-stub-when', wrap).textContent = `Coming in SP${sp}`;
  return wrap;
}

/**
 * Builds a stub app into `root`. Settings also has "Respawn at nearest hospital" (spec §13 Vehicle stuck), calling
 * `onRespawn`, and lists the key bindings from config/client.json.
 */
export function buildStubApp(
  root: HTMLElement,
  app: StubAppName,
  onRespawn: () => void = () => undefined,
  bindings: ClientBindings = clientConfig.input.bindings,
): void {
  const { title, sp } = STUB_APPS[app];
  const wrap = buildComingSoon(root, title, sp);
  if (app !== 'settings') return;
  el('h4', 'phone-section', wrap).textContent = 'Stuck?';
  const respawn = el('button', 'phone-btn phone-respawn', wrap);
  respawn.type = 'button';
  respawn.dataset.action = 'respawn';
  respawn.textContent = 'Respawn at nearest hospital';
  respawn.addEventListener('click', onRespawn);
  el('p', 'phone-settings-note', wrap).textContent = 'You go on foot; your vehicles stay where they are and orders are kept';
  el('h4', 'phone-section', wrap).textContent = 'Controls';
  const list = el('dl', 'phone-bindings', wrap);
  const row = (label: string, keys: string): void => {
    el('dt', '', list).textContent = label;
    el('dd', '', list).textContent = keys;
  };
  for (const name of Object.keys(BINDING_LABEL) as BindingName[]) {
    const codes = bindings[name];
    if (codes.length) row(BINDING_LABEL[name], codes.map(keyLabel).join(' / '));
  }
  row('Look', 'Mouse');
  row('Close phone', ['Esc', ...bindings.phone.map(keyLabel)].join(' / '));
}
