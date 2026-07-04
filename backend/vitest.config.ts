import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Test files share a single Postgres instance and a single 'lucas' user
    // (goals, sessions, etc. are all singletons per user). Running files in
    // parallel workers causes cross-file races on that shared state, so force
    // sequential execution for a deterministic suite.
    fileParallelism: false,
  },
});
