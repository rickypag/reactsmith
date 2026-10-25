import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject } from '../helpers.js';

const router = { library: 'react-router', version: 7, mode: 'data' };
const docs = 'src/features/docs';

const TREE = {
  [`${docs}/index.ts`]: "export { docsRoutes } from './routes';\n",
  [`${docs}/views/QueriesView/QueriesView.tsx`]: 'export const QueriesView: React.FC = () => <h1>Queries</h1>;\n',
  [`${docs}/views/QueriesView/index.ts`]: "export { QueriesView as Component } from './QueriesView';\n",
  [`${docs}/components/QueryList/QueryList.tsx`]: 'export const QueryList: React.FC = () => <ul />;\n',
  [`${docs}/components/QueryList/index.ts`]: "export { QueryList } from './QueryList';\n",
  'src/features/billing/index.ts': '',
  'src/features/billing/views/BillingView/BillingView.tsx': 'export const BillingView: React.FC = () => <h1>Billing</h1>;\n',
  'src/features/billing/views/BillingView/index.ts': "export { BillingView as Component } from './BillingView';\n",
  'src/app/layouts/RootLayout/RootLayout.tsx': "import { Outlet } from 'react-router';\nexport const RootLayout: React.FC = () => <div><Outlet /></div>;\n",
  'src/app/layouts/RootLayout/index.ts': "export { RootLayout } from './RootLayout';\n",
  'src/app/views/NotFoundView/NotFoundView.tsx': 'export const NotFoundView: React.FC = () => <h1>Not found</h1>;\n',
  'src/app/views/NotFoundView/index.ts': "export { NotFoundView as Component } from './NotFoundView';\n",
  'src/app/router.tsx': [
    "import { createBrowserRouter, type RouteObject } from 'react-router';",
    "import { RootLayout } from './layouts/RootLayout';",
    "import { docsRoutes } from '@/features/docs';",
    "const routes: RouteObject[] = [{ path: '/', Component: RootLayout, children: [{ path: 'docs', children: docsRoutes }, { path: '*', lazy: () => import('./views/NotFoundView') }] }];",
    'export const router = createBrowserRouter(routes);',
    '',
  ].join('\n'),
};

const routes = (...entries: string[]) =>
  `import type { RouteObject } from 'react-router';\n\nexport const docsRoutes: RouteObject[] = [\n${entries.map((entry) => `  ${entry},`).join('\n')}\n];\n`;

async function routeIssues(tree: Record<string, string>) {
  const root = await createProject({ ...TREE, ...tree }, { appFiles: 'app', alias: '@', router });
  return (await checkStructure(root)).issues.filter((issue) => issue.code === 'route-not-a-view').map((issue) => issue.message);
}

describe('check: routes render views', () => {
  it('accepts views of the feature, and app views, layouts and features in the app router', async () => {
    expect(await routeIssues({ [`${docs}/routes.tsx`]: routes("{ path: 'queries', lazy: () => import('./views/QueriesView') }") })).toEqual([]);
  });

  it('refuses a component used as a page, another feature\'s view, and a view that does not exist', async () => {
    const issues = await routeIssues({
      [`${docs}/routes.tsx`]: routes(
        "{ path: 'list', lazy: () => import('./components/QueryList') }",
        "{ path: 'billing', lazy: () => import('../billing/views/BillingView') }",
        "{ path: 'gone', lazy: () => import('./views/GoneView') }",
      ),
    });
    expect(issues).toEqual([
      '"./components/QueryList" is not a view of feature "docs": the routes of feature "docs" only render its own views.',
      '"../billing/views/BillingView" is not a view of feature "docs": the routes of feature "docs" only render its own views.',
      '"./views/GoneView" points to the view "GoneView", which doesn\'t exist.',
    ]);
  });

  it('refuses a component in the app router', async () => {
    const appRouter = TREE['src/app/router.tsx'].replace("import { RootLayout } from './layouts/RootLayout';", "import { RootLayout } from './layouts/RootLayout';\nimport { QueryList } from '@/features/docs/components/QueryList';\nimport { TopBar } from './components/TopBar';");
    const issues = await routeIssues({
      [`${docs}/routes.tsx`]: routes(),
      'src/app/router.tsx': appRouter,
      'src/app/components/TopBar/TopBar.tsx': 'export const TopBar: React.FC = () => <header />;\n',
      'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
    });
    expect(issues).toEqual(['"./components/TopBar" is not a view of the app: the app router only renders app views, layouts and features.']);
  });
});
