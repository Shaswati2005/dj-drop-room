import { describe, expect, it } from 'vitest';
import { arSupported } from '../src/xr-support.js';

describe('arSupported (AR -> Club fallback)', () => {
  it('is true when immersive-ar is supported', async () => {
    expect(await arSupported({ isSessionSupported: async (m) => m === 'immersive-ar' })).toBe(true);
  });
  it('is false when immersive-ar is unsupported', async () => {
    expect(await arSupported({ isSessionSupported: async () => false })).toBe(false);
  });
  it('is false when WebXR is missing', async () => {
    expect(await arSupported(undefined)).toBe(false);
    expect(await arSupported(null)).toBe(false);
    expect(await arSupported({} as never)).toBe(false);
  });
  it('is false when the support check throws or rejects', async () => {
    expect(await arSupported({ isSessionSupported: async () => { throw new Error('boom'); } })).toBe(false);
    expect(await arSupported({ isSessionSupported: () => { throw new Error('sync'); } })).toBe(false);
  });
});
