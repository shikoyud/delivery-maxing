import { expect, test } from 'vitest';
import { economyConfig } from '../../src/config';
import { boostMultiplier } from '../../src/economy/boost';

test('$0 locked is ×1, $50 is ×1.15, $100 and $1,000 are ×1.3', () => {
  expect(boostMultiplier(0, economyConfig)).toBe(1);
  expect(boostMultiplier(50_000_000, economyConfig)).toBeCloseTo(1.15, 12);
  expect(boostMultiplier(100_000_000, economyConfig)).toBeCloseTo(1.3, 12);
  expect(boostMultiplier(1_000_000_000, economyConfig)).toBeCloseTo(1.3, 12);
  expect(boostMultiplier(50_000_000)).toBeCloseTo(1.15, 12); // the shipped config by default
  expect(economyConfig.lock.days).toBe(7);
});
