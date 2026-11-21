import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = ['file-misplaced'] as const;

/** The parts of the rule, in page order. */
export const sections = {
  units: 'Views, layouts and components',
  shared: 'Shared components',
  features: 'Features',
  app: 'The app folder',
} as const;

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Every file where it belongs',
    config: { appFiles: 'app' },
    tree: {
      'src/main.tsx': '',
      'src/app/App.tsx': '',
      'src/app/router.tsx': '',
      'src/app/constants.ts': '',
      'src/app/views/HomeView/HomeView.tsx': '',
      'src/app/views/HomeView/index.ts': '',
      'src/components/buttons/index.ts': '',
      'src/components/buttons/PrimaryButton/PrimaryButton.tsx': '',
      'src/features/docs/index.ts': '',
      'src/features/docs/routes.tsx': '',
      'src/features/docs/constants.ts': '',
      'src/features/docs/layouts/DocsLayout/DocsLayout.tsx': '',
      'src/features/docs/.gitkeep': '',
      'src/hooks/useTheme.ts': '',
    },
    issues: [],
  },
  {
    section: 'units',
    title: 'A view file directly in views/',
    config: { appFiles: 'app' },
    tree: { 'src/app/views/NotFoundView.tsx': '' },
    issues: [
      {
        issue: 'error file-misplaced src/app/views/NotFoundView.tsx',
        message: '"NotFoundView.tsx" is directly in src/app/views/, which holds only view folders.',
        hint: 'Move it to src/app/views/NotFoundView/NotFoundView.tsx and add an index.ts exporting it as Component.',
      },
    ],
  },
  {
    section: 'units',
    title: 'A layout file directly in layouts/',
    config: { appFiles: 'app' },
    tree: { 'src/features/docs/index.ts': '', 'src/features/docs/layouts/DocsLayout.tsx': '' },
    issues: [
      {
        issue: 'error file-misplaced src/features/docs/layouts/DocsLayout.tsx',
        message: '"DocsLayout.tsx" is directly in src/features/docs/layouts/, which holds only layout folders.',
        hint: 'Move it to src/features/docs/layouts/DocsLayout/DocsLayout.tsx and add an index.ts exporting it.',
      },
    ],
  },
  {
    section: 'units',
    title: 'A style file directly in components/',
    config: { appFiles: 'app' },
    tree: { 'src/app/components/Sidebar.module.css': '' },
    issues: [
      {
        issue: 'error file-misplaced src/app/components/Sidebar.module.css',
        message: '"Sidebar.module.css" is directly in src/app/components/, which holds only component folders.',
        hint: 'Move it to src/app/components/Sidebar/Sidebar.module.css and add an index.ts exporting it.',
      },
    ],
  },
  {
    section: 'shared',
    title: 'A shared component outside the folder of its type',
    config: { appFiles: 'app' },
    tree: { 'src/components/Badge.tsx': '' },
    issues: [
      {
        issue: 'error file-misplaced src/components/Badge.tsx',
        message: '"Badge.tsx" is directly in src/components/, which holds only the folders of the component types.',
        hint: 'Move it into the folder of its type: src/components/<type>/Badge/Badge.tsx.',
      },
    ],
  },
  {
    section: 'shared',
    title: 'A component file directly in its type folder',
    config: { appFiles: 'app' },
    tree: { 'src/components/buttons/index.ts': '', 'src/components/buttons/IconButton.tsx': '' },
    issues: [
      {
        issue: 'error file-misplaced src/components/buttons/IconButton.tsx',
        message: '"IconButton.tsx" is directly in src/components/buttons/, which holds only component folders and its index.ts.',
        hint: 'Move it to src/components/buttons/IconButton/IconButton.tsx, add an index.ts exporting it, and export it from src/components/buttons/index.ts.',
      },
    ],
  },
  {
    section: 'features',
    title: 'A file directly in features/',
    config: { appFiles: 'app' },
    tree: { 'src/features/index.ts': '' },
    issues: [
      {
        issue: 'error file-misplaced src/features/index.ts',
        message: '"index.ts" is directly in src/features/, which holds only feature folders.',
        hint: 'Move it into a feature folder or into a shared folder.',
      },
    ],
  },
  {
    section: 'features',
    title: 'A helper file at the root of a feature',
    config: { appFiles: 'app' },
    tree: { 'src/features/docs/index.ts': '', 'src/features/docs/helpers.ts': '' },
    issues: [
      {
        issue: 'error file-misplaced src/features/docs/helpers.ts',
        message: '"helpers.ts" is directly in src/features/docs/, which holds only folders and index.ts, routes.tsx, constants.ts.',
        hint: "Move it into one of the feature's folders: assets/, components/, hooks/, layouts/, stores/, types/, utils/, views/.",
      },
    ],
  },
  {
    section: 'app',
    title: 'A component file at the root of the app folder',
    config: { appFiles: 'app' },
    tree: { 'src/app/App.tsx': '', 'src/app/Header.tsx': '' },
    issues: [
      {
        issue: 'error file-misplaced src/app/Header.tsx',
        message: '"Header.tsx" is directly in src/app/, which holds only folders and the App files, router.tsx, constants.ts.',
        hint: "Move it into one of the app's folders: components/, layouts/, styles/, views/.",
      },
    ],
  },
  {
    section: 'app',
    title: 'App files in the app folder when "appFiles" keeps them at the top of src',
    config: { appFiles: 'root' },
    tree: { 'src/App.tsx': '', 'src/app/App.css': '' },
    issues: [
      {
        issue: 'error file-misplaced src/app/App.css',
        message: '"App.css" is directly in src/app/, which holds only folders and router.tsx, constants.ts.',
        hint: '"appFiles" is "root" in reactsmith.config.json: move it to src/App.css, or set "appFiles" to "app".',
      },
    ],
  },
];
