import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject } from '../helpers.js';

const router = { library: 'react-router', version: 7, mode: 'data' };
const APP_ROUTER = "import { createBrowserRouter } from 'react-router';\nexport const router = createBrowserRouter([]);\n";
const ROUTES = "import type { RouteObject } from 'react-router';\n\nexport const docsRoutes: RouteObject[] = [];\n";

async function routerIssues(tree: Record<string, string>) {
  const root = await createProject({ 'src/app/router.tsx': APP_ROUTER, 'src/features/docs/index.ts': "export { docsRoutes } from './routes';\n", 'src/features/docs/routes.tsx': ROUTES, ...tree }, { appFiles: 'app', router });
  return (await checkStructure(root)).issues.filter((issue) => /router-outside|routes-file/.test(issue.code)).map((issue) => `${issue.code}: ${issue.message}`);
}

describe('check: one router', () => {
  it('accepts the router in the app router file, and in tests', async () => {
    expect(await routerIssues({ 'src/features/docs/docs.test.tsx': "import { createMemoryRouter } from 'react-router';\ncreateMemoryRouter([]);\n" })).toEqual([]);
  });

  it('refuses a router created anywhere else', async () => {
    const issues = await routerIssues({
      'src/app/components/Shell/Shell.tsx': "import { BrowserRouter } from 'react-router-dom';\nexport const Shell: React.FC = () => <BrowserRouter />;\n",
      'src/features/docs/router.ts': "import { createHashRouter as hash } from 'react-router';\nexport const docsRouter = hash([]);\n",
    });
    expect(issues).toEqual([
      'router-outside-app-router: <BrowserRouter> (line 2) creates a router outside the app router.',
      'router-outside-app-router: hash (line 2) creates a router outside the app router.',
    ]);
  });

  it('keeps a feature routes file to its routes', async () => {
    const routes = `${ROUTES}export const loader = () => null;\nfunction helper() {}\n`;
    expect(await routerIssues({ 'src/features/docs/routes.tsx': routes })).toEqual([
      'routes-file-content: Line 4 is not part of the routes: a routes file only exports its routes, an array of route objects.',
      'routes-file-content: Line 5 is not part of the routes: a routes file only exports its routes, an array of route objects.',
    ]);
  });
});
