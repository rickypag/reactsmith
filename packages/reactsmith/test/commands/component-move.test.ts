import { describe, expect, it } from 'vitest';
import { componentUpdateCommand } from '../../src/commands/component/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const app = 'src/app/components';
const docs = 'src/features/docs/components';
const view = 'src/features/docs/views/HomeView/HomeView.tsx';

/** A component folder: its file (with `body` as its JSX and `imports` above), style file and index. */
const component = (folder: string, name: string, imports: string[] = [], body = '<div className={styles.root} />') => ({
  [`${folder}/${name}/${name}.tsx`]: lines(`import styles from './${name}.module.css';`, ...imports, '', `export interface ${name}Props {}`, '', `export const ${name}: React.FC<${name}Props> = () => {`, `  return ${body};`, '};'),
  [`${folder}/${name}/${name}.module.css`]: '.root {\n}\n',
  [`${folder}/${name}/index.ts`]: `export { ${name} } from './${name}';\nexport type { ${name}Props } from './${name}';\n`,
});

const TREE = {
  'src/features/docs/index.ts': '',
  ...component(app, 'Sidebar', ["import { SidebarGroup } from '../SidebarGroup';"], '<aside className={styles.root}><SidebarGroup /></aside>'),
  ...component(app, 'SidebarGroup', ["import type { SidebarLinkProps } from '../SidebarLink';", "import { SidebarLink } from '../SidebarLink';", "import { Card } from '@/components/cards';"], '<nav className={styles.root}><Card /><SidebarLink /></nav>'),
  ...component(app, 'SidebarLink'),
  ...component(app, 'TopBar'),
  ...component('src/components/cards', 'Card'),
  ...component('src/components/cards', 'Tile'),
  'src/components/cards/index.ts': lines("export { Card } from './Card';", "export type { CardProps } from './Card';", "export { Tile } from './Tile';", "export type { TileProps } from './Tile';"),
  ...component(docs, 'UserCard'),
  [view]: lines(
    "import styles from './HomeView.module.css';",
    "import { Card, Tile } from '@/components/cards';",
    "import { UserCard } from '../../components/UserCard';",
    '',
    'export const HomeView: React.FC = () => {',
    '  return (',
    '    <div className={styles.root}>',
    '      <Card />',
    '      <Tile />',
    '      <UserCard />',
    '    </div>',
    '  );',
    '};',
  ),
  'src/features/docs/views/HomeView/HomeView.module.css': '.root {\n}\n',
  'src/features/docs/views/HomeView/index.ts': "export { HomeView as Component } from './HomeView';\n",
  'src/features/docs/routes.tsx': lines("import type { RouteObject } from 'react-router';", '', "export const docsRoutes: RouteObject[] = [{ index: true, lazy: () => import('./views/HomeView') }];"),
};

interface Move {
  feature?: string;
  app?: boolean;
  type?: string;
  name?: string;
}

const move = (root: string, target: string, to: Move) =>
  componentUpdateCommand.run({ cwd: root, args: { target }, options: { name: to.name, interface: undefined, removeInterface: undefined, renameInterface: undefined, default: undefined, feature: to.feature, app: to.app ?? false, type: to.type, dryRun: false } });
const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);
const errors = async (root: string) => (await checkStructure(root)).issues.filter((issue) => issue.severity === 'error');

describe('component update: moving to another owner', () => {
  it('moves a component with the components only it uses, and keeps the project valid', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(await errors(root)).toEqual([]);
    const result = await move(root, 'Sidebar', { feature: 'docs' });
    expect(codes(result)).toEqual([]);
    for (const name of ['Sidebar', 'SidebarGroup', 'SidebarLink']) {
      expect(await exists(root, `${docs}/${name}/${name}.tsx`)).toBe(true);
      expect(await exists(root, `${app}/${name}`)).toBe(false);
    }
    // TopBar is not Sidebar's: it stays. The imports between the moved components need no change.
    expect(await exists(root, `${app}/TopBar/TopBar.tsx`)).toBe(true);
    expect(await read(root, `${docs}/SidebarGroup/SidebarGroup.tsx`)).toContain("import { SidebarLink } from '../SidebarLink';");
    expect(result.actions?.filter((action) => action.type === 'move' && !action.path.includes('.')).map((action) => action.message)).toEqual([
      `→ ${docs}/Sidebar`,
      `→ ${docs}/SidebarGroup (only "Sidebar" uses it)`,
      `→ ${docs}/SidebarLink (only "Sidebar" uses it)`,
    ]);
    expect(await errors(root)).toEqual([]);
  });

  it('takes a name out of the barrel import of its type, and rewrites usages', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await move(root, 'Tile', { feature: 'docs' }))).toEqual([]);
    const code = await read(root, view);
    expect(code).toContain("import { Card } from '@/components/cards';\nimport { Tile } from '../../components/Tile';");
    expect(await read(root, 'src/components/cards/index.ts')).toBe(lines("export { Card } from './Card';", "export type { CardProps } from './Card';"));
    expect(await errors(root)).toEqual([]);
  });

  it('moves into a type of shared components: its barrel offers it, usages import from it', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await move(root, 'UserCard', { type: 'cards' }))).toEqual([]);
    // One import of the barrel, not two.
    expect(await read(root, view)).toContain("import { Card, Tile, UserCard } from '@/components/cards';\n\nexport");
    expect(await read(root, 'src/components/cards/index.ts')).toContain("export { UserCard } from './UserCard';\nexport type { UserCardProps } from './UserCard';");
    expect(await errors(root)).toEqual([]);
  });

  it('refuses a move that would break the import rules, and changes nothing', async () => {
    const tree = {
      ...TREE,
      'src/app/layouts/RootLayout/RootLayout.tsx': lines("import { Outlet } from 'react-router';", "import { Sidebar } from '../../components/Sidebar';", '', 'export const RootLayout: React.FC = () => {', '  return <div><Sidebar /><Outlet /></div>;', '};'),
      'src/app/layouts/RootLayout/index.ts': "export { RootLayout } from './RootLayout';\n",
    };
    const root = await createProject(tree, { appFiles: 'app' });
    const result = await move(root, 'Sidebar', { feature: 'docs' });
    expect(codes(result)).toEqual(['move-breaks-imports']);
    expect(result.issues?.[0]?.message).toMatch(/After moving "Sidebar" to feature "docs": .*\(feature-deep-import\)/);
    expect(await exists(root, `${app}/Sidebar/Sidebar.tsx`)).toBe(true);
  });

  it('refuses the same owner, a missing feature, and a rename in the same run', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await move(root, 'Sidebar', { app: true }))).toEqual(['component-move-same']);
    expect(codes(await move(root, 'Sidebar', { feature: 'blog' }))).toEqual(['feature-missing']);
    expect(codes(await move(root, 'Sidebar', { feature: 'docs', name: 'DocsSidebar' }))).toEqual(['options-conflict']);
    expect(codes(await move(root, 'Sidebar', { feature: 'docs', app: true }))).toEqual(['options-conflict']);
  });
});
