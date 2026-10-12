import { describe, expect, it } from 'vitest';
import { movementConfig } from '@dm/shared';
import { clientConfig } from '../src/clientConfig';

describe('clientConfig', () => {
  it('water sits below the ground top and above the out-of-bounds height', () => {
    expect(clientConfig.graphics.waterLevel).toBeLessThan(0);
    expect(clientConfig.graphics.waterLevel).toBeGreaterThan(movementConfig.fall.outOfBoundsY);
  });

  it('camera far plane reaches past the fog end', () => {
    expect(clientConfig.camera.near).toBeGreaterThan(0);
    expect(clientConfig.camera.far).toBeGreaterThan(clientConfig.graphics.fogFar);
  });
});
