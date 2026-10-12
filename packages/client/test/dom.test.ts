import { describe, expect, it } from 'vitest';
import { clientConfig } from '../src/clientConfig';
import { keyLabel } from '../src/ui/dom';

describe('keyLabel', () => {
  it('turns binding codes into short key labels', () => {
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('Mouse0')).toBe('Mouse 1');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('Space')).toBe('Space');
  });

  it('labels the configured interact binding (kiosk prompt)', () => {
    expect(keyLabel(clientConfig.input.bindings.interact[0]!)).toBe('E');
  });
});

describe('ui tuning', () => {
  it('is in config', () => {
    expect(clientConfig.ui.expressUrgentSeconds).toBeGreaterThan(0);
    expect(clientConfig.ui.maxPopups).toBeGreaterThanOrEqual(1);
  });
});
