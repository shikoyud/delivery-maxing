import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hint = /<div class="play-hint"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1]?.replace(/<[^>]+>/g, ' ') ?? '';

describe('play hint', () => {
  it('explains the third-person controls: mouse orbits, WASD is camera-relative, zip rides the way you face', () => {
    expect(hint).toMatch(/Mouse orbits the camera/);
    expect(hint).toMatch(/WASD move relative to the camera/);
    expect(hint).toMatch(/zip line rides the way you face/i);
    for (const key of ['Shift sprint', 'Space jump', 'C crouch', 'E interact', 'Q board']) expect(hint).toContain(key);
    expect(hint).toContain('Shift sprint (toggle)');
  });
});
