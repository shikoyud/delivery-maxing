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

  it('labels the configured interact, phone and accept bindings', () => {
    expect(keyLabel(clientConfig.input.bindings.interact[0]!)).toBe('E');
    expect(keyLabel(clientConfig.input.bindings.phone[0]!)).toBe('Tab');
    expect(keyLabel(clientConfig.input.bindings.accept[0]!)).toBe('Y');
  });
});

describe('ui tuning', () => {
  it('is in config', () => {
    expect(clientConfig.ui.timerUrgentSeconds).toBeGreaterThan(0);
    expect(clientConfig.ui.maxPopups).toBeGreaterThanOrEqual(1);
  });
});
