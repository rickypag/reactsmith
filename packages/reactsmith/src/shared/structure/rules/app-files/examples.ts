import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['app-files-location', 'app-files-undecided'] as const;

export const examples: RuleExample[] = [
  {
    title: 'App files in the app folder',
    config: { appFiles: 'app' },
    tree: { 'src/main.tsx': '', 'src/app/App.tsx': '', 'src/app/App.css': '' },
    issues: [],
  },
  {
    title: 'App files kept at the top of src',
    config: { appFiles: 'root' },
    tree: { 'src/main.tsx': '', 'src/App.tsx': '', 'src/App.css': '' },
    issues: [],
  },
  {
    title: 'App files left in src when they belong in the app folder',
    config: { appFiles: 'app' },
    tree: { 'src/App.tsx': '', 'src/App.css': '' },
    issues: [
      {
        issue: 'error app-files-location src',
        message: 'App.css, App.tsx must be in src/app/, not in src/.',
        hint: 'Run "reactsmith init" to move them and update their imports, or set "appFiles": "root" in reactsmith.config.json.',
      },
    ],
  },
  {
    title: 'App files in src before choosing where they go',
    tree: { 'src/App.tsx': '' },
    issues: [
      {
        issue: 'warning app-files-undecided src',
        message: 'App.tsx is in src/ and "appFiles" is not set.',
        hint: 'Run "reactsmith init" to choose, or set "appFiles" in reactsmith.config.json to "app" (move them to src/app/) or "root" (keep them where they are).',
      },
    ],
  },
];
