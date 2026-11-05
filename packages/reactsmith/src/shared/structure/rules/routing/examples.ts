import type { RuleExample } from '../types.js';

const router = { library: 'react-router', version: 7, mode: 'data' };

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['app-router-missing', 'feature-routes-missing'] as const;

export const examples: RuleExample[] = [
  {
    title: 'The router file and a routes file in each feature',
    config: { appFiles: 'app', router },
    tree: { 'src/app/router.tsx': '', 'src/features/auth/index.ts': '', 'src/features/auth/routes.tsx': '' },
    issues: [],
  },
  {
    title: 'A router is configured, but the app has no router file',
    config: { appFiles: 'app', router },
    tree: { 'src/app/App.tsx': '' },
    issues: [
      {
        issue: 'warning app-router-missing src/app',
        message: 'A router is configured, but src/app/router.tsx does not exist.',
        hint: `Create src/app/router.tsx with the app's routes (mounting each feature's routes), or set "appRouter" in reactsmith.config.json.`,
      },
    ],
  },
  {
    title: 'A router is configured, but a feature has no routes file',
    config: { appFiles: 'app', router },
    tree: { 'src/app/router.tsx': '', 'src/features/auth/index.ts': '' },
    issues: [
      {
        issue: 'warning feature-routes-missing src/features/auth',
        message: 'Feature "auth" has no routes file routes.tsx.',
        hint: "Add src/features/auth/routes.tsx exporting the feature's routes. Features without pages can ignore this warning.",
      },
    ],
  },
];
