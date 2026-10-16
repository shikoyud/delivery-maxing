import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_CATEGORIES } from '@dm/shared';
import { categoryColor, lotColor } from '../src/render/city/categoryColors';

describe('categoryColor', () => {
  it('one distinct colour per building category', () => {
    const colors = BUILDING_CATEGORIES.map((c) => categoryColor(c));
    expect(new Set(colors).size).toBe(BUILDING_CATEGORIES.length);
  });

  it('food is warm, office glass-blue, landmark gold', () => {
    const hsl = (c: number) => new THREE.Color(c).getHSL({ h: 0, s: 0, l: 0 });
    expect(hsl(categoryColor('food')).h).toBeLessThan(0.12);
    expect(hsl(categoryColor('office')).h).toBeGreaterThan(0.5);
    expect(hsl(categoryColor('office')).h).toBeLessThan(0.7);
    expect(hsl(categoryColor('landmark')).h).toBeGreaterThan(0.1);
    expect(hsl(categoryColor('landmark')).h).toBeLessThan(0.17);
  });
});

describe('lotColor', () => {
  it('is stable per id and a missing/ id draws darker than its category', () => {
    expect(lotColor('lot-1', 'mega/House_01', 'residential').getHex()).toBe(lotColor('lot-1', 'mega/House_01', 'residential').getHex());
    const l = (c: THREE.Color) => c.getHSL({ h: 0, s: 0, l: 0 }).l;
    const base = l(new THREE.Color(categoryColor('industrial')));
    for (const id of ['lot-1', 'lot-2', 'lot-3', 'lot-4']) {
      expect(l(lotColor(id, 'missing/Warehouse_01', 'industrial'))).toBeLessThan(base - 0.08);
    }
  });
});
