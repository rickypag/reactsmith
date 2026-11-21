import type { RuleExample } from '../types.js';

const router = { library: 'react-router', version: 7, mode: 'data' };

/** Every code the rule reports. Each one has at least one example. */
export const codes = [
  'app-router-missing',
  'feature-routes-missing',
  'router-outside-app-router',
  'routes-file-content',
  'route-not-a-view',
  'layout-repeats-parent',
] as const;

const lines = (...text: string[]) => `${text.join('\n')}\n`;

/** A layout rendering `parts` from the shared layout components, around the pages. */
const layout = (name: string, parts: string[]) =>
  lines(
    "import { Outlet } from 'react-router';",
    ...parts.map((part) => `import { ${part} } from '@/components/layout';`),
    `export const ${name}: React.FC = () => <div>${parts.map((part) => `<${part} />`).join('')}<Outlet /></div>;`,
  );

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
  {
    title: 'A router created outside the app router',
    config: { appFiles: 'app', router },
    tree: {
      'src/app/router.tsx': '',
      'src/app/components/Shell/Shell.tsx': "import { BrowserRouter } from 'react-router-dom';\nexport const Shell: React.FC = () => <BrowserRouter />;\n",
    },
    issues: ['error router-outside-app-router src/app/components/Shell/Shell.tsx'],
  },
  {
    title: 'A routes file with more than its routes',
    config: { appFiles: 'app', router },
    tree: {
      'src/app/router.tsx': '',
      'src/features/docs/index.ts': '',
      'src/features/docs/routes.tsx': lines("import type { RouteObject } from 'react-router';", 'export const docsRoutes: RouteObject[] = [];', 'function helper() {}'),
    },
    issues: ['error routes-file-content src/features/docs/routes.tsx'],
  },
  {
    title: 'A route that renders a component instead of a view',
    config: { appFiles: 'app', router },
    tree: {
      'src/app/router.tsx': '',
      'src/features/docs/index.ts': '',
      'src/features/docs/components/QueryList/QueryList.tsx': 'export const QueryList: React.FC = () => <ul />;\n',
      'src/features/docs/routes.tsx': lines("import type { RouteObject } from 'react-router';", "export const docsRoutes: RouteObject[] = [{ path: 'list', lazy: () => import('./components/QueryList') }];"),
    },
    issues: ['error route-not-a-view src/features/docs/routes.tsx'],
  },
  {
    title: 'A layout that repeats a part of the layout around it',
    config: { appFiles: 'app', router, alias: '@' },
    tree: {
      'src/app/router.tsx': lines(
        "import { createBrowserRouter, type RouteObject } from 'react-router';",
        "import { RootLayout } from './layouts/RootLayout';",
        "import { ShellLayout } from './layouts/ShellLayout';",
        "const routes: RouteObject[] = [{ path: '/', Component: RootLayout, children: [{ path: 'docs', Component: ShellLayout, children: [] }] }];",
        'export const router = createBrowserRouter(routes);',
      ),
      'src/app/layouts/RootLayout/RootLayout.tsx': layout('RootLayout', ['TopBar']),
      'src/app/layouts/RootLayout/index.ts': "export { RootLayout } from './RootLayout';\n",
      'src/app/layouts/ShellLayout/ShellLayout.tsx': layout('ShellLayout', ['TopBar']),
      'src/app/layouts/ShellLayout/index.ts': "export { ShellLayout } from './ShellLayout';\n",
    },
    issues: ['warning layout-repeats-parent src/app/layouts/ShellLayout/ShellLayout.tsx'],
  },
];
