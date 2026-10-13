import { el } from './dom';

export type PopupTone = 'good' | 'info' | 'warn';

/** What DeliveryLoop needs from the popups (tests pass a recorder). */
export interface PopupSink {
  show(text: string, lines?: string[], tone?: PopupTone): void;
}

/** Stacked toast popups (delivery complete, package collected, …); each fades out after `seconds`. */
export class Popups implements PopupSink {
  private readonly root: HTMLElement;

  constructor(
    host: HTMLElement,
    private readonly seconds: number,
    private readonly max: number,
  ) {
    this.root = el('div', 'popups', host);
    this.root.setAttribute('aria-live', 'polite');
  }

  show(text: string, lines: string[] = [], tone: PopupTone = 'good'): void {
    const p = el('div', `popup popup-${tone}`, this.root);
    el('div', 'popup-title', p).textContent = text;
    for (const line of lines) el('div', 'popup-line', p).textContent = line;
    p.style.setProperty('--popup-life', `${this.seconds}s`);
    // Keep at most `max` on screen; the oldest goes first.
    while (this.root.children.length > this.max) this.root.firstElementChild?.remove();
    window.setTimeout(() => p.remove(), this.seconds * 1000);
  }
}
