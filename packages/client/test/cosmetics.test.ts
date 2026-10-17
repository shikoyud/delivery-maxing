import { describe, expect, test } from 'vitest';
import * as THREE from 'three';
import { carModelScale, finishMaterial, lookOf } from '../src/render/cosmetics';
import { defaultWardrobe, equipItem, type Wardrobe } from '../src/economy/wardrobe';

describe('cosmetics', () => {
  test('finishMaterial sets the gold, chrome and neon parameters', () => {
    const gold = new THREE.MeshStandardMaterial();
    finishMaterial('gold', gold);
    expect([gold.color.getHex(), gold.metalness, gold.roughness, gold.emissive.getHex()]).toEqual([0xd4a017, 1, 0.3, 0]);
    const chrome = new THREE.MeshStandardMaterial();
    finishMaterial('chrome', chrome);
    expect([chrome.color.getHex(), chrome.metalness, chrome.roughness]).toEqual([0xdfe3e8, 1, 0.1]);
    const neon = new THREE.MeshStandardMaterial();
    finishMaterial('neon', neon);
    expect([neon.color.getHex(), neon.emissive.getHex(), neon.emissiveIntensity]).toEqual([0x39ff14, 0x39ff14, 0.6]);
    // A finish over another finish leaves none of the first behind (neon's glow, gold's metal).
    finishMaterial('gold', neon);
    expect([neon.emissive.getHex(), neon.metalness]).toEqual([0, 1]);
    // The metals reflect something: without an environment a metal draws black under the hemisphere light.
    expect(gold.envMap).not.toBeNull();
    // The renderer prefilters it on a cube a quarter of its width: a tiny map gives a broken prefilter (black metal).
    expect((gold.envMap as THREE.DataTexture).image.width / 4).toBeGreaterThanOrEqual(16);
  });

  test('the pack car is scaled to its 4.4 m collider (Decision 13)', () => {
    expect(carModelScale(3.3, 4.4)).toBeCloseTo(4.4 / 3.3);
  });

  test('the look follows the equipped items; the factory paint has no colour; an unowned premium skin falls back', () => {
    const w0 = defaultWardrobe();
    expect(lookOf(w0, [])).toEqual({ outfit: { color: 0x1f9e93 }, vehicle: { color: null }, bag: 0xd8b98a, phone: 0x10262d });
    const owned: Wardrobe = { ...w0, owned: [...w0.owned, 'cosmetic.vehicle.cherry', 'cosmetic.phone.rose'] };
    const w = equipItem(equipItem(owned, 'cosmetic.vehicle.cherry', [])!, 'cosmetic.phone.rose', [])!;
    expect(lookOf(w, [])).toMatchObject({ vehicle: { color: 0xc8323c }, phone: 0xe88aa6 });
    // A saved Gold outfit the chain no longer owns (parseWardrobe keeps it): the free Teal outfit is drawn.
    const gold: Wardrobe = { ...w0, equipped: { ...w0.equipped, outfit: 'skin.outfit.gold' } };
    expect(lookOf(gold, []).outfit).toEqual({ color: 0x1f9e93 });
    expect(lookOf(gold, ['skin.outfit.gold']).outfit).toEqual({ finish: 'gold' });
  });

  test('equipItem: only owned cosmetics and chain-owned skins of a slot', () => {
    const w = defaultWardrobe();
    expect(equipItem(w, 'cosmetic.outfit.coral', [])).toBeNull();
    expect(equipItem(w, 'skin.vehicle.neon', [])).toBeNull();
    expect(equipItem(w, 'line.bag.1', [])).toBeNull();
    expect(equipItem(w, 'nope', [])).toBeNull();
    expect(equipItem(w, 'skin.vehicle.neon', ['skin.vehicle.neon'])!.equipped.vehicle).toBe('skin.vehicle.neon');
    expect(w.equipped.vehicle).toBe('cosmetic.vehicle.factory');
  });
});
