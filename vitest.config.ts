import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{core,toolkit,gen,universe,view,forge,app}/**/*.test.ts'],
    environment: 'node',
    // Golden and end-to-end tests render every generator; under parallel load they need time.
    testTimeout: 30_000,
  },
});
