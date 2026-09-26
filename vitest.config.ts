import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{core,toolkit,gen,universe,forge,app}/**/*.test.ts'],
    environment: 'node',
  },
});
