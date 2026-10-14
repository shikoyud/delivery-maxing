import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { playHintHidden } from '../src/ui/playHint';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hint = /<div class="play-hint"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]?.replace(/<[^>]+>/g, ' ') ?? '';

describe('play hint', () => {
  it('explains the third-person controls: mouse orbits, WASD is camera-relative, Tab phone, Y accept, F mount', () => {
    expect(hint).toMatch(/Mouse orbits the camera/);
    expect(hint).toMatch(/WASD move relative to the camera/);
    expect(hint).not.toMatch(/zip/i);
    for (const key of ['Shift sprint', 'Space jump', 'C crouch', 'E interact', 'Tab phone', 'Y accept', 'F mount']) expect(hint).toContain(key);
    expect(hint).toContain('Shift sprint (toggle)');
  });
});

describe('playHintHidden', () => {
  it('hides the hint while the pointer is locked or the phone is open (the phone always releases the lock)', () => {
    expect(playHintHidden({ locked: false, phoneOpen: false })).toBe(false);
    expect(playHintHidden({ locked: true, phoneOpen: false })).toBe(true);
    expect(playHintHidden({ locked: false, phoneOpen: true })).toBe(true);
    expect(playHintHidden({ locked: true, phoneOpen: true })).toBe(true);
  });
});
