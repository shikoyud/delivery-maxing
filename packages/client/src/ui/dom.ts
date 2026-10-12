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
