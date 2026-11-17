import { symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { createProject, read } from '../helpers.js';

const navItem = 'src/app/components/NavItem/NavItem.tsx';
const id = 'app/components/NavItem/NavItem.tsx';
const sidebar = 'src/app/components/Sidebar/Sidebar.tsx';
const NAV_ITEM_INTERFACE = 'icon: LucideIcon; label: string; to: string; selected?: boolean; content: React.ReactNode; mystery: Mystery';

/**
 * Runs `test` in a project with the repo's real lucide-react and react-router, so their types and exports are found.
 * The link to node_modules goes before the project is deleted.
 */
async function withProject(test: (root: string) => Promise<void>): Promise<void> {
  const root = await createProject(
    {
      'package.json': JSON.stringify({ name: 'app', dependencies: { 'lucide-react': '*', 'react-router': '*', react: '*' } }),
      'tsconfig.app.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, lib: ['ES2022', 'DOM'] }, include: ['src'] }),
      [sidebar]: "import styles from './Sidebar.module.css';\n\nexport const Sidebar: React.FC = () => {\n  return <aside className={styles.root} />;\n};\n",
      'src/app/components/Sidebar/Sidebar.module.css': '.root {\n}\n',
      'src/app/components/Sidebar/index.ts': "export { Sidebar } from './Sidebar';\n",
    },
    { appFiles: 'app', icons: { library: 'lucide-react' }, router: { library: 'react-router', version: 7, mode: 'data' } },
  );
  const modules = path.join(root, 'node_modules');
  await symlink(fileURLToPath(new URL('../../../../node_modules', import.meta.url)), modules, 'junction');
  try {
    await test(root);
  } finally {
    await unlink(modules);
  }
}

const createNavItem = (root: string) =>
  componentCreateCommand.run({
    cwd: root,
    args: { name: 'NavItem' },
    options: { feature: undefined, app: true, type: undefined, interface: NAV_ITEM_INTERFACE, rootProps: 'to={to}', from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: 'NavLink', text: undefined, jsx: undefined, replace: false, dryRun: false },
  });

const insert = (root: string, tag: string, into: string, options: { name?: string; props?: string } = {}) =>
  elementInsertCommand.run({
    cwd: root,
    args: { name: tag },
    options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into, position: undefined, from: undefined, props: options.props, text: undefined, message: undefined, name: options.name, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('component props that hold a component', () => {
  it('imports a type of the interface from the package that exports it, without a placeholder', () =>
    withProject(async (root) => {
      expect(codes(await createNavItem(root))).toEqual(['type-placeholder']);
      const text = await read(root, navItem);
      expect(text).toContain("import type { LucideIcon } from 'lucide-react';");
      expect(text).toContain("import type { Mystery } from './types';");
      expect(await read(root, 'src/app/components/NavItem/types.ts')).not.toContain('LucideIcon');
    }), 60_000);

  it('renders a component prop as an element: destructured with a capital, named and styled', () =>
    withProject(async (root) => {
      await createNavItem(root);
      const result = await insert(root, '{icon}', `${id}#root`, { name: 'icon', props: 'size={24}' });
      expect(result.issues).toEqual([]);
      expect(result.summary).toBe(`Rendered the prop {icon} in ${navItem}: ${id}#icon.`);
      const text = await read(root, navItem);
      expect(text).toContain('= ({ to, icon: Icon }) =>');
      expect(text).toContain('<Icon className={styles.icon} size={24} />');
      expect(await read(root, 'src/app/components/NavItem/NavItem.module.css')).toContain('.icon {');
    }), 60_000);

  it('refuses props that are not components, with what to do instead', () =>
    withProject(async (root) => {
      await createNavItem(root);
      expect(codes(await insert(root, '{content}', `${id}#root`))).toEqual(['prop-render-node']);
      expect(codes(await insert(root, '{label}', `${id}#root`))).toEqual(['prop-not-component']);
      expect(codes(await insert(root, '{missing}', `${id}#root`))).toEqual(['prop-unknown']);
      expect(codes(await insert(root, '{icon}', `${id}#root`, { props: 'nope={1}' }))).toEqual(['element-props-invalid']);
    }), 60_000);

  it('passes a component by name, importing it from where it is found', () =>
    withProject(async (root) => {
      await createNavItem(root);
      const result = await insert(root, 'NavItem', 'app/components/Sidebar/Sidebar.tsx#root', { props: "icon={LayoutDashboardIcon} label='Dashboard' to='/' content={null} mystery={null}" });
      expect(codes(result)).toEqual([]);
      const text = await read(root, sidebar);
      expect(text).toContain("import { LayoutDashboardIcon } from 'lucide-react';");
      expect(text).toContain('<NavItem icon={LayoutDashboardIcon}');
      expect(codes(await insert(root, 'NavItem', 'app/components/Sidebar/Sidebar.tsx#root', { props: "icon={NoSuchIcon} label='x' to='/' content={null} mystery={null}" }))).toEqual(['icon-not-found']);
    }), 60_000);
});
