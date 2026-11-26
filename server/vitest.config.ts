import {defineConfig} from 'vitest/config';

// Backend tests run against an in-process PostgreSQL (PGlite): no Docker needed.
export default defineConfig({
  // The shared contract lives outside this root (../shared/logistics).
  server: {fs: {allow: ['..']}},
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each file boots its own PGlite instance; give the WASM start-up room.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
