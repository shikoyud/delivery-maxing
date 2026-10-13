/**
 * A minimal stand-in for the DOM (the repo has no jsdom): just what the phone UI uses — createElement, children,
 * className/classList, dataset, hidden, disabled, title, textContent and event listeners. `installFakeDom()` puts a
 * fake `document` on globalThis for `el()`; elements are cast to HTMLElement at the boundary.
 */

type Listener = (e: FakeEvent) => void;

export interface FakeEvent {
  type: string;
  code?: string;
  target?: FakeElement;
  defaultPrevented?: boolean;
  propagationStopped?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export function fakeEvent(type: string, extra: Partial<FakeEvent> = {}): FakeEvent {
  const e: FakeEvent = {
    type,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      e.defaultPrevented = true;
    },
    stopPropagation() {
      e.propagationStopped = true;
    },
    ...extra,
  };
  return e;
}

class Listeners {
  private readonly map = new Map<string, Listener[]>();
  addEventListener(type: string, fn: Listener): void {
    const list = this.map.get(type) ?? [];
    list.push(fn);
    this.map.set(type, list);
  }
  removeEventListener(type: string, fn: Listener): void {
    const list = this.map.get(type) ?? [];
    this.map.set(
      type,
      list.filter((f) => f !== fn),
    );
  }
  dispatchEvent(e: FakeEvent): void {
    for (const fn of [...(this.map.get(e.type) ?? [])]) fn(e);
  }
}

export class FakeElement extends Listeners {
  className = '';
  hidden = false;
  disabled = false;
  title = '';
  type = '';
  innerHTML = '';
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly style = { setProperty: (): void => undefined };
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  private text = '';

  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument,
  ) {
    super();
  }

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    for (const c of this.children) c.parentNode = null;
    this.children = [];
    this.text = v;
  }

  readonly classList = {
    contains: (c: string): boolean => this.className.split(/\s+/).includes(c),
    add: (c: string): void => {
      if (!this.classList.contains(c)) this.className = `${this.className} ${c}`.trim();
    },
    remove: (c: string): void => {
      this.className = this.className
        .split(/\s+/)
        .filter((x) => x && x !== c)
        .join(' ');
    },
    toggle: (c: string, force?: boolean): boolean => {
      const on = force ?? !this.classList.contains(c);
      if (on) this.classList.add(c);
      else this.classList.remove(c);
      return on;
    },
  };

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(c: FakeElement): FakeElement {
    return this.insertBefore(c, null);
  }

  insertBefore(c: FakeElement, ref: FakeElement | null): FakeElement {
    c.remove();
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c);
    else this.children.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }

  replaceChild(next: FakeElement, old: FakeElement): FakeElement {
    this.insertBefore(next, old);
    old.remove();
    return old;
  }

  remove(): void {
    const p = this.parentNode;
    if (!p) return;
    p.children = p.children.filter((x) => x !== this);
    this.parentNode = null;
  }

  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(fakeEvent('click', { target: this }));
  }

  /** Depth-first search of this element's subtree (itself included). */
  findAll(pred: (e: FakeElement) => boolean): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (e: FakeElement): void => {
      if (pred(e)) out.push(e);
      for (const c of e.children) walk(c);
    };
    walk(this);
    return out;
  }

  /** Elements whose class list contains `cls`. */
  byClass(cls: string): FakeElement[] {
    return this.findAll((e) => e.classList.contains(cls));
  }

  /** Whether this element and every ancestor are not hidden. */
  get visible(): boolean {
    return !this.hidden && (this.parentNode === null || this.parentNode.visible);
  }
}

export class FakeDocument extends Listeners {
  pointerLockElement: FakeElement | null = null;
  createElement(tag: string): FakeElement {
    return new FakeElement(tag.toUpperCase(), this);
  }
  exitPointerLock(): void {
    this.pointerLockElement = null;
  }
}

/** Sets a fake `document` on globalThis (for `el()`); returns it and a fresh host element. Call `restore` after. */
export function installFakeDom(): { doc: FakeDocument; host: FakeElement; asHost: HTMLElement; restore(): void } {
  const g = globalThis as { document?: unknown };
  const prev = g.document;
  const doc = new FakeDocument();
  g.document = doc;
  const host = doc.createElement('div');
  return {
    doc,
    host,
    asHost: host as unknown as HTMLElement,
    restore() {
      g.document = prev;
    },
  };
}

export const asEl = (e: FakeElement): HTMLElement => e as unknown as HTMLElement;
export const asFake = (e: HTMLElement): FakeElement => e as unknown as FakeElement;
