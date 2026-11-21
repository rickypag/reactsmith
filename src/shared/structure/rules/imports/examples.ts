import type { RuleExample } from '../types.js';

/** Every code the rule reports. Each one has at least one example. */
export const codes = [
  'component-deep-import',
  'view-deep-import',
  'layout-deep-import',
  'hooks-deep-import',
  'utils-deep-import',
  'types-deep-import',
  'stores-deep-import',
  'shared-component-import',
  'view-import-outside-routes',
  'layout-import-outside-routes',
  'feature-deep-import',
  'feature-imports-app',
  'shared-imports-app',
  'shared-imports-feature',
  'feature-cycle',
] as const;

/** The parts of the rule, in page order. */
export const sections = {
  units: 'Through the entry point',
  pages: 'Views and layouts',
  direction: 'One direction',
  cycles: 'Loops',
} as const;

const config = { appFiles: 'app', alias: '@' };
const main = 'src/main.tsx';

/** A project whose main.tsx imports `specifier`. */
const importing = (specifier: string, tree: Record<string, string> = {}) => ({ ...tree, [main]: `import '${specifier}';\n` });

export const examples: RuleExample<keyof typeof sections>[] = [
  {
    title: 'Imports through entry points and public APIs',
    config,
    tree: {
      'src/features/docs/index.ts': "export { Toc } from './components/Toc';\n",
      'src/features/docs/components/Toc/index.ts': "export { Toc } from './Toc';\n",
      'src/app/App.tsx': "import { Toc } from '@/features/docs';\nimport { formatDate } from '@/utils';\n",
    },
    issues: [],
  },
  {
    section: 'units',
    title: 'A file inside a component, imported from outside it',
    config,
    tree: importing('@/app/components/TopBar/TopBar'),
    issues: [
      {
        issue: `error component-deep-import ${main}`,
        message: '"@/app/components/TopBar/TopBar" imports from inside component "TopBar".',
        hint: 'Import from its folder (its index.ts) instead, and export what you need there.',
      },
    ],
  },
  { section: 'units', title: 'A file inside a view', config, tree: importing('@/app/views/HomeView/HomeView'), issues: [`error view-deep-import ${main}`, `error view-import-outside-routes ${main}`] },
  { section: 'units', title: 'A file inside a layout', config, tree: importing('@/app/layouts/RootLayout/RootLayout'), issues: [`error layout-deep-import ${main}`, `error layout-import-outside-routes ${main}`] },
  { section: 'units', title: 'A file inside hooks/', config, tree: importing('@/hooks/useTheme'), issues: [`error hooks-deep-import ${main}`] },
  { section: 'units', title: 'A file inside utils/', config, tree: importing('@/utils/date'), issues: [`error utils-deep-import ${main}`] },
  { section: 'units', title: 'A file inside types/', config, tree: importing('@/types/user'), issues: [`error types-deep-import ${main}`] },
  { section: 'units', title: 'A file inside stores/', config, tree: importing('@/stores/session'), issues: [`error stores-deep-import ${main}`] },
  {
    section: 'units',
    title: 'A shared component imported past the barrel of its type',
    config,
    tree: importing('@/components/buttons/PrimaryButton'),
    issues: [`error shared-component-import ${main}`],
  },
  {
    section: 'units',
    title: 'A file inside a feature, imported from outside it',
    config,
    tree: importing('@/features/docs/components/Toc'),
    issues: [`error feature-deep-import ${main}`],
  },
  {
    section: 'pages',
    title: 'A view imported by a component',
    config,
    tree: { 'src/app/components/TopBar/TopBar.tsx': "import { HomeView } from '../../views/HomeView';\n" },
    issues: ['error view-import-outside-routes src/app/components/TopBar/TopBar.tsx'],
  },
  {
    section: 'pages',
    title: 'A layout imported by a component',
    config,
    tree: { 'src/app/components/TopBar/TopBar.tsx': "import { RootLayout } from '../../layouts/RootLayout';\n" },
    issues: ['error layout-import-outside-routes src/app/components/TopBar/TopBar.tsx'],
  },
  {
    section: 'direction',
    title: 'A feature importing from the app folder',
    config,
    tree: { 'src/features/docs/routes.tsx': "import { TopBar } from '@/app/components/TopBar';\n" },
    issues: ['error feature-imports-app src/features/docs/routes.tsx'],
  },
  {
    section: 'direction',
    title: 'A shared folder importing from the app folder',
    config,
    tree: { 'src/utils/date.ts': "import { LOCALE } from '@/app/constants';\n" },
    issues: ['error shared-imports-app src/utils/date.ts'],
  },
  {
    section: 'direction',
    title: 'A shared folder importing a feature',
    config,
    tree: { 'src/utils/date.ts': "import { DOCS } from '@/features/docs';\n" },
    issues: ['error shared-imports-feature src/utils/date.ts'],
  },
  {
    section: 'cycles',
    title: 'Two features importing each other',
    config,
    tree: {
      'src/features/docs/index.ts': "export { Blog } from '@/features/blog';\n",
      'src/features/blog/index.ts': "export { Docs } from '@/features/docs';\n",
    },
    issues: [
      {
        issue: 'warning feature-cycle src/features',
        message: 'Features import each other in a loop: blog → docs → blog.',
      },
    ],
  },
];
