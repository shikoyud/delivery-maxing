import { expect, test } from 'vitest';
import { NO_MODS } from '../../src/movement/types';

test('NO_MODS allows sprint', () => {
  expect(NO_MODS.canSprint).toBe(true);
  expect(NO_MODS.speedMul).toBe(1);
  expect(NO_MODS.jumpHeightMul).toBe(1);
});
