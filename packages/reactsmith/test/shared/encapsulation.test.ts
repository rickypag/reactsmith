import { describe, expect, it } from 'vitest';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject } from '../helpers.js';

const sidebar = 'src/features/docs/components/Sidebar';
const COMPONENT = {
  [`${sidebar}/Sidebar.tsx`]: "import { WIDTH } from './constants';\nexport const Sidebar: React.FC = () => <aside>{WIDTH}</aside>;\n",
  [`${sidebar}/constants.ts`]: "export const WIDTH = '15rem';\n",
  [`${sidebar}/index.ts`]: "export { Sidebar } from './Sidebar';\n",
  'src/features/docs/index.ts': '',
};

/** The deep-import issues of a project with one more file, `importer`, holding `code`. */
async function deepImports(importer: string, code: string, tree: Record<string, string> = COMPONENT) {
  const root = await createProject({ ...tree, [importer]: code }, { appFiles: 'app', alias: '@' });
  return (await checkStructure(root)).issues.filter((issue) => issue.code.endsWith('-deep-import')).map((issue) => `${issue.code}: ${issue.message}`);
}

const view = 'src/features/docs/views/HomeView/HomeView.tsx';
const viewCode = (from: string) => `import { Sidebar } from '${from}';\nexport const HomeView: React.FC = () => <main><Sidebar /></main>;\n`;
const VIEW_ENTRY = { 'src/features/docs/views/HomeView/index.ts': "export { HomeView as Component } from './HomeView';\n" };

describe('check: components, views and layouts are imported through their entry point', () => {
  it('accepts the folder and its index, relative or with the alias', async () => {
    for (const from of ['../../components/Sidebar', '../../components/Sidebar/index', '@/features/docs/components/Sidebar']) {
      expect(await deepImports(view, viewCode(from), { ...COMPONENT, ...VIEW_ENTRY })).toEqual([]);
    }
  });

  it('refuses the files inside a component from outside its folder', async () => {
    expect(await deepImports(view, viewCode('../../components/Sidebar/Sidebar'), { ...COMPONENT, ...VIEW_ENTRY })).toEqual([
      'component-deep-import: "../../components/Sidebar/Sidebar" imports from inside component "Sidebar".',
    ]);
    const constants = "import { WIDTH } from '@/features/docs/components/Sidebar/constants';\nexport const HomeView: React.FC = () => <main>{WIDTH}</main>;\n";
    expect(await deepImports(view, constants, { ...COMPONENT, ...VIEW_ENTRY })).toEqual([
      'component-deep-import: "@/features/docs/components/Sidebar/constants" imports from inside component "Sidebar".',
    ]);
  });

  it('lets the files of a folder import each other, and tests reach anywhere', async () => {
    const content = `${sidebar}/SidebarContent.tsx`;
    expect(await deepImports(content, "import { WIDTH } from './constants';\nexport const SidebarContent: React.FC = () => <div>{WIDTH}</div>;\n")).toEqual([]);
    expect(await deepImports('src/features/docs/Sidebar.test.tsx', "import { Sidebar } from './components/Sidebar/Sidebar';\n")).toEqual([]);
  });

  it('applies to views and layouts too', async () => {
    const routes = (from: string) => `export const docsRoutes = [{ index: true, lazy: () => import('${from}') }];\n`;
    const tree = { ...COMPONENT, ...VIEW_ENTRY, [view]: viewCode('../../components/Sidebar') };
    expect(await deepImports('src/features/docs/routes.tsx', routes('./views/HomeView'), tree)).toEqual([]);
    expect(await deepImports('src/features/docs/routes.tsx', routes('./views/HomeView/HomeView'), tree)).toEqual([
      'view-deep-import: "./views/HomeView/HomeView" imports from inside view "HomeView".',
    ]);

    const layout = {
      'src/app/layouts/RootLayout/RootLayout.tsx': "import { Outlet } from 'react-router';\nexport const RootLayout: React.FC = () => <div><Outlet /></div>;\n",
      'src/app/layouts/RootLayout/index.ts': "export { RootLayout } from './RootLayout';\n",
    };
    expect(await deepImports('src/app/router.tsx', "import { RootLayout } from './layouts/RootLayout/RootLayout';\n", layout)).toEqual([
      'layout-deep-import: "./layouts/RootLayout/RootLayout" imports from inside layout "RootLayout".',
    ]);
  });
});
