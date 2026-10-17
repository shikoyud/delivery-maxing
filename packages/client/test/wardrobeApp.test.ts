import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { defaultWardrobe, type Wardrobe } from '../src/economy/wardrobe';
import { createWardrobeApp, wardrobeRows } from '../src/ui/phone/wardrobeApp';
import { installFakeDom, type FakeElement } from './fakeDom';
import { model } from './phoneFixtures';

describe('Wardrobe app', () => {
  let dom: ReturnType<typeof installFakeDom>;
  beforeEach(() => {
    dom = installFakeDom();
  });
  afterEach(() => dom.restore());

  const rowEl = (root: FakeElement, id: string): FakeElement => root.findAll((e) => e.classList.contains('phone-wardrobe-row') && e.dataset.id === id)[0]!;
  const button = (root: FakeElement, id: string): FakeElement => rowEl(root, id).findAll((e) => e.tagName === 'BUTTON')[0]!;

  test('equipping an owned outfit calls equip; unowned items are greyed with "In the Shop"', () => {
    const calls: string[] = [];
    const view = createWardrobeApp({ equip: (id) => void calls.push(id) });
    const root = view.el as unknown as FakeElement;
    const w0 = defaultWardrobe();
    const w: Wardrobe = { ...w0, owned: [...w0.owned, 'cosmetic.outfit.coral'] };
    view.render(model({ wardrobe: wardrobeRows(w, []) }), { x: 0, y: 0, z: 0 }, 0);
    // Four sections, each with its six Coin items.
    expect(root.byClass('phone-section').map((s) => s.textContent)).toEqual(['Outfits', 'Vehicle paint', 'Bags', 'Phone cases']);
    expect(root.byClass('phone-wardrobe-row')).toHaveLength(24);
    expect(button(root, 'cosmetic.outfit.teal').textContent).toBe('Equipped');
    expect(button(root, 'cosmetic.outfit.teal').disabled).toBe(true);
    expect(button(root, 'cosmetic.outfit.coral').textContent).toBe('Equip');
    button(root, 'cosmetic.outfit.coral').click();
    expect(calls).toEqual(['cosmetic.outfit.coral']);
    const sky = rowEl(root, 'cosmetic.outfit.sky');
    expect(sky.classList.contains('shop')).toBe(true);
    expect(button(root, 'cosmetic.outfit.sky').textContent).toBe('In the Shop');
    expect(button(root, 'cosmetic.outfit.sky').disabled).toBe(true);
    button(root, 'cosmetic.outfit.sky').click();
    expect(calls).toEqual(['cosmetic.outfit.coral']);
  });

  test('premium finishes appear once the chain owns them', () => {
    const w = defaultWardrobe();
    expect(wardrobeRows(w, []).some((r) => r.itemId.startsWith('skin.'))).toBe(false);
    const rows = wardrobeRows({ ...w, equipped: { ...w.equipped, vehicle: 'skin.vehicle.chrome' } }, ['skin.outfit.gold', 'skin.vehicle.chrome']);
    const gold = rows.find((r) => r.itemId === 'skin.outfit.gold')!;
    expect(gold).toMatchObject({ section: 'Outfits', state: 'equip', finish: 'gold' });
    expect(rows.find((r) => r.itemId === 'skin.vehicle.chrome')).toMatchObject({ section: 'Vehicle paint', state: 'equipped' });
    expect(rows.find((r) => r.itemId === 'cosmetic.vehicle.factory')!.state).toBe('equip');
    // A saved skin the chain no longer owns is not shown, and the slot's free item is the one worn.
    const lost = wardrobeRows({ ...w, equipped: { ...w.equipped, outfit: 'skin.outfit.neon' } }, []);
    expect(lost.find((r) => r.itemId === 'skin.outfit.neon')).toBeUndefined();
    expect(lost.find((r) => r.itemId === 'cosmetic.outfit.teal')!.state).toBe('equipped');
  });
});
