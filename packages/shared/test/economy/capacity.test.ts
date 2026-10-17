import { expect, test } from 'vitest';
import { economyConfig, vehiclesConfig } from '../../src/config';
import { effectiveCapacity, vehicleCapacity } from '../../src/economy/capacity';

test('Bag 5 on a bicycle is 3 slots and 25 kg; Bag 0 in a car is 1 slot and 0 kg; Bag 5 in a car is 6 and 150', () => {
  expect(effectiveCapacity(5, 'bicycle', economyConfig, vehiclesConfig)).toEqual({ slots: 3, maxPackageKg: 25 });
  expect(effectiveCapacity(0, 'car', economyConfig, vehiclesConfig)).toEqual({ slots: 1, maxPackageKg: 0 });
  expect(effectiveCapacity(5, 'car', economyConfig, vehiclesConfig)).toEqual({ slots: 6, maxPackageKg: 150 });
  expect(effectiveCapacity(2, 'walk')).toEqual({ slots: 2, maxPackageKg: 10 }); // shipped configs by default
  expect(effectiveCapacity(3, 'motorbike')).toEqual({ slots: 4, maxPackageKg: 50 });
  expect(vehicleCapacity('skateboard')).toEqual({ slots: 2, maxPackageKg: 10 });
});
