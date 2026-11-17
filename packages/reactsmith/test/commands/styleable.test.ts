import { describe, expect, it } from 'vitest';
import { componentUpdateCommand } from '../../src/commands/component/update/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const components = 'src/app/components';
const topBar = `${components}/TopBar/TopBar.tsx`;
const navMenu = `${components}/NavMenu/NavMenu.tsx`;
const badge = `${components}/Badge/Badge.tsx`;
const H = 'app/components/TopBar/TopBar.tsx#header';

const TREE = {
  [topBar]: lines(
    "import styles from './TopBar.module.css';",
    "import { NavMenu } from '../NavMenu';",
    '',
    'export const TopBar: React.FC = () => {',
    '  return (',
    '    <header className={styles.root}>',
    "      <NavMenu label='Products' />",
    '    </header>',
    '  );',
    '};',
  ),
  [`${components}/TopBar/TopBar.module.css`]: '.root {\n}\n',
  [`${components}/TopBar/index.ts`]: "export { TopBar } from './TopBar';\n",
  [navMenu]: lines(
    "import styles from './NavMenu.module.css';",
    '',
    'export interface NavMenuProps {',
    '  label: string;',
    '}',
    '',
    'export const NavMenu: React.FC<NavMenuProps> = ({ label }) => {',
    '  return <button className={styles.root}>{label}</button>;',
    '};',
  ),
  [`${components}/NavMenu/NavMenu.module.css`]: '.root {\n}\n',
  [`${components}/NavMenu/index.ts`]: "export { NavMenu } from './NavMenu';\nexport type { NavMenuProps } from './NavMenu';\n",
  [badge]: "import styles from './Badge.module.css';\n\nexport const Badge: React.FC = () => {\n  return <span className={styles.root}>New</span>;\n};\n",
  [`${components}/Badge/Badge.module.css`]: '.root {\n}\n',
  [`${components}/Badge/index.ts`]: "export { Badge } from './Badge';\n",
};

const styleUpdate = (root: string, target: string, name: string | undefined, css: string) =>
  styleUpdateCommand.run({
    cwd: root,
    args: { target },
    options: { name, state: undefined, css, cssFile: undefined, object: undefined, objectFile: undefined, class: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, when: undefined, at: undefined, dryRun: false },
  });

const insert = (root: string, name: string, options: { props?: string; name?: string }) =>
  elementInsertCommand.run({
    cwd: root,
    args: { name },
    options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into: H, position: undefined, from: undefined, props: options.props, text: undefined, message: undefined, name: options.name, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });

describe('styling a component from its parent', () => {
  it('gives the usage a class from the parent and makes the component merge it into its root', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    const result = await styleUpdate(root, `${H}/NavMenu`, 'menu', 'margin-left: auto');
    expect(result.issues).toEqual([]);

    expect(await read(root, topBar)).toContain("<NavMenu className={styles.menu} label='Products' />");
    expect(await read(root, `${components}/TopBar/TopBar.module.css`)).toContain('.menu {\n  margin-left: auto;\n}\n');
    expect(await read(root, navMenu)).toBe(
      lines(
        "import type { StyleableProps } from '@/types';",
        "import { cx } from '@/utils';",
        "import styles from './NavMenu.module.css';",
        '',
        'export interface NavMenuProps extends StyleableProps {',
        '  label: string;',
        '}',
        '',
        'export const NavMenu: React.FC<NavMenuProps> = ({ label, className }) => {',
        '  return <button className={cx(styles.root, className)}>{label}</button>;',
        '};',
      ),
    );
    expect(await exists(root, 'src/types/styleable.ts')).toBe(true);
    expect(await read(root, 'src/utils/cx.ts')).toContain('export function cx(');
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('types a component without props React.FC<StyleableProps>, with no empty interface, and doesn\'t change a styleable one again', async () => {
    const root = await createProject(TREE, { appFiles: 'app', alias: '@' });
    expect((await insert(root, 'Badge', { name: 'badge' })).issues).toEqual([]);
    const text = await read(root, badge);
    expect(text).toContain("import type { StyleableProps } from '@/types';");
    expect(text).toContain('export const Badge: React.FC<StyleableProps> = ({ className }) => {');
    expect(text).not.toContain('interface BadgeProps');
    expect(text).toContain('<span className={cx(styles.root, className)}>New</span>');
    expect(await read(root, `${components}/Badge/index.ts`)).not.toContain('BadgeProps');

    expect((await insert(root, 'Badge', { name: 'second' })).issues).toEqual([]);
    expect(await read(root, badge)).toBe(text);

    // Its first prop gives it an interface that extends StyleableProps; removing the last one goes back.
    const update = (options: { interface?: string; removeInterface?: string }) =>
      componentUpdateCommand.run({ cwd: root, args: { target: 'Badge' }, options: { name: undefined, interface: options.interface, removeInterface: options.removeInterface, renameInterface: undefined, default: undefined, feature: undefined, app: false, type: undefined, dryRun: false } });
    expect((await update({ interface: 'tone?: string' })).issues).toEqual([]);
    expect(await read(root, badge)).toContain('export interface BadgeProps extends StyleableProps {\n  tone?: string;\n}\n\nexport const Badge: React.FC<BadgeProps> =');
    expect((await update({ removeInterface: 'tone' })).issues).toEqual([]);
    const back = await read(root, badge);
    expect(back).toContain('export const Badge: React.FC<StyleableProps> =');
    expect(back).not.toContain('interface BadgeProps');
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('follows a renamed prop in StyleableProps', async () => {
    const root = await createProject({ ...TREE, 'src/types/styleable.ts': 'export interface StyleableProps {\n  classes?: string;\n}\n', 'src/utils/cx.ts': 'export function cx() {}\n' }, { appFiles: 'app' });
    await styleUpdate(root, `${H}/NavMenu`, 'menu', 'margin-left: auto');
    expect(await read(root, topBar)).toContain('<NavMenu classes={styles.menu}');
    expect(await read(root, navMenu)).toContain('<button className={cx(styles.root, classes)}>');
  });

  it('refuses an inline style on a component of the project', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    const result = await insert(root, 'NavMenu', { props: "label='Docs' style={{ color: 'red' }}" });
    expect(result.issues?.map((issue) => issue.code)).toEqual(['component-inline-style']);
  });
});

describe('check: styling components', () => {
  const usage = (jsx: string) => ({ ...TREE, [topBar]: TREE[topBar]!.replace("<NavMenu label='Products' />", jsx) });
  const codes = async (tree: Record<string, string>) =>
    (await checkStructure(await createProject(tree, { appFiles: 'app' }))).issues.map((issue) => issue.code).filter((code) => /styleable|inline-style/.test(code));

  it('reports inline styles and classes given to components that do not take them', async () => {
    expect(await codes(usage("<NavMenu label='Products' style={{ color: 'red' }} />"))).toEqual(['component-inline-style']);
    expect(await codes(usage("<NavMenu label='Products' className={styles.menu} />"))).toEqual(['component-not-styleable']);
  });

  it('requires a styleable component to merge the class into its root', async () => {
    const notMerged = TREE[navMenu]!.replace('export interface NavMenuProps {', "import type { StyleableProps } from '../../../types/styleable';\nexport interface NavMenuProps extends StyleableProps {");
    expect(await codes({ ...TREE, [navMenu]: notMerged })).toEqual(['styleable-not-merged']);
  });
  it('makes a component styleable when its interface gets className, as styling it from a parent does', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    const update = (members: string) =>
      componentUpdateCommand.run({
        cwd: root,
        args: { target: 'NavMenu' },
        options: { name: undefined, interface: members, removeInterface: undefined, renameInterface: undefined, default: undefined, feature: undefined, app: false, type: undefined, dryRun: false },
      });
    expect((await update('className?: string; open?: boolean')).issues).toEqual([]);
    const text = await read(root, navMenu);
    expect(text).toContain('export interface NavMenuProps extends StyleableProps {');
    expect(text).toContain('<button className={cx(styles.root, className)}>');
    expect(text).toContain('  open?: boolean;');
    expect(text).not.toContain('className?: string');
    expect((await update('className?: string')).issues).toEqual([]);
    expect(await read(root, navMenu)).toBe(text);
  });
});
