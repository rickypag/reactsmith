import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Parked work (the Figma skill) keeps its tests, which don't run until it comes back.
    exclude: [...configDefaults.exclude, 'parked/**', 'apps/**', 'vercel-example/**'],
    // Init and Next tests run TypeScript on whole projects: on a busy machine they pass 5s, and a timeout would block
    // a publish (prepublishOnly runs the tests).
    testTimeout: 15_000,
  },
});
