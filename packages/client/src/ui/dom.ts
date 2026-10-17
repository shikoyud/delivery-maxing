/** Escapes text for use inside HTML markup. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/** m:ss for countdowns (rounded up, so 0:01 shows until the last moment). */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  parent?.appendChild(e);
  return e;
}

/** The "Mock wallet" badge shown wherever GAME appears (Decision 1): the HUD's GAME figure, the Shop, Skip, the Wallet. */
export function mockBadge(parent: HTMLElement, className = ''): HTMLElement {
  const b = el('span', `phone-mock-badge${className ? ` ${className}` : ''}`, parent);
  b.textContent = 'Mock wallet';
  b.title = 'GAME here is a browser mock of the reward program: no real tokens';
  return b;
}

/** Sets innerHTML only when it changed (keeps hover and click targets stable between frames). */
export function setHtml(e: HTMLElement, html: string): void {
  if (e.dataset.html !== html) {
    e.innerHTML = html;
    e.dataset.html = html;
  }
}

export function setText(e: HTMLElement, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}

/** A short label for a KeyboardEvent.code binding: "KeyE" → "E", "Digit1" → "1", "Mouse0" → "Mouse 1". */
export function keyLabel(code: string): string {
  const key = /^Key([A-Z])$/.exec(code) ?? /^Digit(\d)$/.exec(code);
  if (key) return key[1]!;
  const mouse = /^Mouse(\d)$/.exec(code);
  if (mouse) return `Mouse ${Number(mouse[1]) + 1}`;
  return code.replace(/^(Shift|Control|Alt)(Left|Right)$/, '$1');
}

/**
 * Keeps `list`'s children in step with `items` by key: existing elements are updated in place (so a button under the
 * cursor is never replaced between mousedown and click), missing ones created, stale ones removed.
 */
export function syncList<T, V extends { el: HTMLElement }>(
  list: HTMLElement,
  views: Map<string, V>,
  items: readonly T[],
  key: (item: T) => string,
  create: (item: T) => V,
  update: (view: V, item: T) => void,
): void {
  const keep = new Set(items.map(key));
  for (const [k, v] of views) {
    if (!keep.has(k)) {
      v.el.remove();
      views.delete(k);
    }
  }
  items.forEach((item, i) => {
    const k = key(item);
    let v = views.get(k);
    if (!v) views.set(k, (v = create(item)));
    update(v, item);
    const at = list.children[i] ?? null;
    if (at !== v.el) list.insertBefore(v.el, at);
  });
}

/**
 * Whether a key event's target is a text field (an input, textarea, select or contenteditable: the Wallet's amount,
 * lil-gui fields): typing there must not drive the player or close the phone or the map (Escape still closes them).
 */
export function isTypingTarget(t: EventTarget | null | undefined): boolean {
  const e = t as { isContentEditable?: boolean; tagName?: string } | null | undefined;
  if (!e) return false;
  return e.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.tagName ?? '');
}
