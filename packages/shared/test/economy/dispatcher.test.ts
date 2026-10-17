import { expect, test } from 'vitest';
import { economyConfig } from '../../src/config';
import { dispatcherTuning } from '../../src/economy/dispatcher';

test('tier 0 is 3 shown at ×1.0; tier 5 is 5 shown at ×0.5 with long ×2.5 and modifiers ×2.0', () => {
  expect(dispatcherTuning(0, economyConfig)).toEqual({ maxShown: 3, intervalScale: 1, longWeightScale: 1, modifierWeightScale: 1 });
  const top = dispatcherTuning(5, economyConfig);
  expect(top).toMatchObject({ maxShown: 5, intervalScale: 0.5 });
  expect(top.longWeightScale).toBeCloseTo(2.5, 12);
  expect(top.modifierWeightScale).toBeCloseTo(2, 12);
  expect([0, 1, 2, 3, 4, 5].map((t) => dispatcherTuning(t).maxShown)).toEqual([3, 3, 4, 4, 5, 5]);
  expect([0, 1, 2, 3, 4, 5].map((t) => dispatcherTuning(t).intervalScale)).toEqual([1, 0.9, 0.8, 0.7, 0.6, 0.5]);
  expect(() => dispatcherTuning(6)).toThrow();
});
