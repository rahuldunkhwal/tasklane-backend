import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Runs before every test file: starts an in-memory MongoDB and sets the env the app needs
    setupFiles: ['tests/setup.ts'],
    // mongodb-memory-server downloads a MongoDB binary (~100 MB) on the first run. Cache it in the
    // OS temp folder instead of node_modules, which sits inside the OneDrive-synced repo.
    env: { MONGOMS_DOWNLOAD_DIR: path.join(os.tmpdir(), 'mongodb-binaries') },
    testTimeout: 20_000,
    hookTimeout: 180_000, // generous: covers that one-time binary download
  },
});
