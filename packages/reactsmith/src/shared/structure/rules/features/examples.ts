import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['feature-public-api-missing', 'feature-unused'] as const;

const config = { appFiles: 'app', alias: '@' };

export const examples: RuleExample[] = [
  {
    title: 'A feature the app uses through its public API',
    config,
    tree: { 'src/features/docs/index.ts': '', 'src/main.tsx': "import '@/features/docs';\n" },
    issues: [],
  },
  {
    title: 'A feature without its public API file',
    config,
    tree: { 'src/features/docs/components/': '' },
    issues: [
      {
        issue: 'warning feature-public-api-missing src/features/docs',
        message: 'Feature "docs" has no public API file index.ts, so it is unused: nothing outside the feature can import it.',
        hint: 'Add src/features/docs/index.ts and export what other code may use.',
      },
    ],
  },
  {
    title: 'A feature nothing imports',
    config,
    tree: { 'src/features/docs/index.ts': '' },
    issues: [
      {
        issue: 'warning feature-unused src/features/docs',
        message: 'Feature "docs" is unused: nothing outside it imports "@/features/docs".',
        hint: 'Use it (e.g. add its routes to the app router) or remove it.',
      },
    ],
  },
];
