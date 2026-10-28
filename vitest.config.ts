import { defineConfig } from 'vitest/config';

// Pure-TS unit tests only; anything that needs Web Audio is checked in the
// browser through window.__dropRoom.
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
