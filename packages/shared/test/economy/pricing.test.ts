import { expect, test } from 'vitest';
import { economyConfig } from '../../src/config';
import { quote, rateUpdateAllowed, usdToGame, type Rate } from '../../src/economy/pricing';

const NOW = 1_800_000_000_000;
const rate: Rate = { usdPerGame: 0.00024, updatedAt: NOW };

test('$10 at $0.00024 per GAME is 41,666,666,667 base units (ceil) and maxGame adds 2%', () => {
  expect(quote(10_000_000, rate, NOW, economyConfig)).toEqual({ ok: true, game: 41_666_666_667, maxGame: Math.ceil(41_666_666_667 * 1.02) });
  // a whole result is not pushed up by float noise: $12 is exactly 50,000 GAME, at most 51,000
  expect(quote(12_000_000, rate, NOW, economyConfig)).toEqual({ ok: true, game: 50_000_000_000, maxGame: 51_000_000_000 });
  expect(usdToGame(120_000, rate)).toBe(500_000_000); // $0.12 ≈ 500 GAME
  expect(usdToGame(10_000_000, rate)).toBe(41_666_666_667);
});

test('a rate older than 15 minutes is stale; no rate is noRate; a move over 20% is refused', () => {
  const age = economyConfig.rate.maxAgeSeconds * 1000;
  expect(economyConfig.rate.maxAgeSeconds).toBe(900);
  expect(quote(1_000_000, rate, NOW + age - 1, economyConfig).ok).toBe(true);
  expect(quote(1_000_000, rate, NOW + age, economyConfig)).toEqual({ ok: false, reason: 'stale' });
  expect(quote(1_000_000, rate, NOW + age + 60_000, economyConfig)).toEqual({ ok: false, reason: 'stale' });
  expect(quote(1_000_000, null, NOW, economyConfig)).toEqual({ ok: false, reason: 'noRate' });
  const p = 0.00024;
  expect(rateUpdateAllowed(p, p * 1.2, economyConfig)).toBe(true);
  expect(rateUpdateAllowed(p, p * 0.8, economyConfig)).toBe(true);
  expect(rateUpdateAllowed(p, p * 1.21, economyConfig)).toBe(false);
  expect(rateUpdateAllowed(p, p * 0.79, economyConfig)).toBe(false);
  expect(rateUpdateAllowed(p, 0, economyConfig)).toBe(false);
  expect(rateUpdateAllowed(p, Number.NaN, economyConfig)).toBe(false);
});
