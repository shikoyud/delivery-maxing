import { el } from './dom';

/** Stacked toast popups (delivery complete, package collected, …); each fades out after `seconds`. */
export class Popups {
  private readonly root: HTMLElement;

  constructor(host: HTMLElement, private readonly seconds: number) {
    this.root = el('div', 'popups', host);
    this.root.setAttribute('aria-live', 'polite');
  }

  show(text: string, lines: string[] = [], tone: 'good' | 'info' | 'warn' = 'good'): void {
    const p = el('div', `popup popup-${tone}`, this.root);
    el('div', 'popup-title', p).textContent = text;
    for (const line of lines) el('div', 'popup-line', p).textContent = line;
    p.style.setProperty('--popup-life', `${this.seconds}s`);
    // Keep at most a few on screen; the oldest goes first.
    while (this.root.children.length > 3) this.root.firstElementChild?.remove();
    window.setTimeout(() => p.remove(), this.seconds * 1000);
  }
}
