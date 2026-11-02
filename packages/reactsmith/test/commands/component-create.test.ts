import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { parseProps } from '../../src/shared/components/props.js';
import { createProject, exists, read, issuesOfUsedCode } from '../helpers.js';

const DOCS = { 'src/features/docs/index.ts': '', 'src/main.tsx': "import '@/features/docs'" };
const dir = 'src/features/docs/components/Sidebar';

interface Options {
  interface?: string;
  props?: string;
  from?: string;
  app?: boolean;
  type?: string;
  direction?: 'row' | 'column';
  gap?: string;
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  padding?: string;
  root?: string;
  text?: string;
  dryRun?: boolean;
}

function run(root: string, name: string, options: Options = {}, feature: string | undefined = 'docs') {
  return componentCreateCommand.run({
    cwd: root,
    args: { name },
    options: {
      feature: options.app ? undefined : feature,
      app: options.app ?? false,
      type: options.type,
      interface: options.interface,
      rootProps: options.props,
      from: options.from,
      direction: options.direction,
      gap: options.gap,
      align: options.align,
      justify: options.justify,
      padding: options.padding,
      root: options.root,
      text: options.text,
      dryRun: options.dryRun ?? false,
    },
  });
}

async function createComponent(name: string, options: Options = {}, config: object = {}) {
  const root = await createProject(DOCS, { appFiles: 'root', ...config });
  return { root, result: await run(root, name, options) };
}

/** The component file as create writes it, with the given imports and props interface. */
function componentText(imports: string[], propsInterface: string[] = [], root = 'div') {
  return [
    ...imports,
    '',
    ...propsInterface,
    `export const Sidebar: React.FC${propsInterface.length ? '<SidebarProps>' : ''} = () => {`,
    `  return <${root} className={styles.root} />;`,
    '};',
    '',
  ].join('\n');
}

describe('parseProps', () => {
  it('keeps members as written and finds the types that need placeholders', () => {
    expect(parseProps('items: NavItem[]; collapsed?: boolean, onSelect: (item: NavItem, e: MouseEvent) => void\nrender<T>(value: T): React.ReactNode')).toEqual({
      members: ['items: NavItem[]', 'collapsed?: boolean', 'onSelect: (item: NavItem, e: MouseEvent) => void', 'render<T>(value: T): React.ReactNode'],
      names: ['items', 'collapsed', 'onSelect', 'render'],
      unknownTypes: ['NavItem'],
      defaults: {},
    });
  });

  it('takes the defaults out of the members, after any separator or on their own line', () => {
    expect(parseProps("open?: boolean = true, size?: 'sm' | 'lg' = 'sm'\nonPick?: (id: string) => void\ngap?: number = 2")).toEqual({
      members: ['open?: boolean', "size?: 'sm' | 'lg'", 'onPick?: (id: string) => void', 'gap?: number'],
      names: ['open', 'size', 'onPick', 'gap'],
      unknownTypes: [],
      defaults: { open: 'true', size: "'sm'", gap: '2' },
    });
  });

  it.each([
    ['items NavItem[]', 'The props are not valid TypeScript'],
    ['a: string; a: number', 'The prop "a" is declared twice.'],
    ['[key: string]: string', 'is not a prop.'],
    ['user: Api.User', '"Api.User" cannot be given a placeholder.'],
    ['open: boolean = true', '"open" has a default value, so it is optional.'],
    ['open?: boolean =', 'has no default value after "="'],
    ['open?: boolean = if', '"if" is not a value.'],
  ])('rejects %j', (text, message) => {
    expect(() => parseProps(text)).toThrow(message);
  });
});

describe('component create', () => {
  it('creates a component with its CSS module, rooted in a layout element, that passes check', async () => {
    const { root, result } = await createComponent('sidebar');
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Component "Sidebar" created in feature "docs".');
    expect(result.actions?.map((a) => `${a.type} ${a.path}`)).toEqual([
      `create ${dir}/Sidebar.tsx`,
      `create ${dir}/Sidebar.module.css`,
      `create ${dir}/index.ts`,
    ]);
    expect(await read(root, `${dir}/Sidebar.tsx`)).toBe(componentText(["import styles from './Sidebar.module.css';"]));
    expect(await read(root, `${dir}/Sidebar.module.css`)).toBe('.root {\n  display: flex;\n  flex-direction: column;\n  gap: var(--space-2);\n}\n');
    expect(await read(root, `${dir}/index.ts`)).toBe("export { Sidebar } from './Sidebar';\n");
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it('writes the layout options as CSS, or as Tailwind classes in a styles file', async () => {
    const layout: Options = { direction: 'row', gap: '1.5', align: 'center', justify: 'between', padding: '2 4' };
    const css = await createComponent('Sidebar', layout);
    expect(await read(css.root, `${dir}/Sidebar.module.css`)).toBe(
      '.root {\n  display: flex;\n  flex-direction: row;\n  gap: 0.375rem;\n  align-items: center;\n  justify-content: space-between;\n  padding: var(--space-2) var(--space-4);\n}\n',
    );

    const tailwind = await createComponent('Sidebar', layout, { styles: 'tailwind' });
    expect(await read(tailwind.root, `${dir}/Sidebar.styles.ts`)).toBe(
      "export const styles = {\n  root: 'flex flex-row gap-1.5 items-center justify-between py-2 px-4',\n};\n",
    );
    expect(await read(tailwind.root, `${dir}/Sidebar.tsx`)).toBe(componentText(["import { styles } from './Sidebar.styles';"]));
    expect(await issuesOfUsedCode(tailwind.root)).toEqual([]);
  });

  it('writes the props interface and placeholders for unknown types', async () => {
    const { root, result } = await createComponent('Sidebar', { interface: 'items: NavItem[]; collapsed?: boolean' });
    expect(await read(root, `${dir}/Sidebar.tsx`)).toBe(
      componentText(
        ["import type { NavItem } from './types';", "import styles from './Sidebar.module.css';"],
        ['export interface SidebarProps {', '  items: NavItem[];', '  collapsed?: boolean;', '}', ''],
      ),
    );
    expect(await read(root, `${dir}/index.ts`)).toBe("export { Sidebar } from './Sidebar';\nexport type { SidebarProps } from './Sidebar';\n");
    expect(await read(root, `${dir}/types.ts`)).toContain('export type NavItem = unknown;\n');
    expect(result.issues?.map((issue) => `${issue.severity} ${issue.code}`)).toEqual(['warning type-placeholder']);
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it('lays out a button or a link in a row, and anything else in a column, with only the layout options given', async () => {
    const button = await createComponent('IconLabel', { root: 'button', align: 'center' });
    const buttonCss = await read(button.root, 'src/features/docs/components/IconLabel/IconLabel.module.css');
    expect(buttonCss).toContain('display: inline-flex;\n  flex-direction: row;\n  align-items: center;');
    expect(buttonCss).not.toContain('gap');
    const box = await createComponent('Box', { padding: '4' });
    const boxCss = await read(box.root, 'src/features/docs/components/Box/Box.module.css');
    expect(boxCss).toContain('flex-direction: column;');
    expect(boxCss).not.toContain('gap');
    const plain = await createComponent('Plain');
    expect(await read(plain.root, 'src/features/docs/components/Plain/Plain.module.css')).toContain('gap: var(--space-2);');
  });

  it('writes a default value as a JSDoc tag on its member', async () => {
    const { root, result } = await createComponent('Sidebar', { interface: 'collapsed?: boolean = true' });
    expect(result.issues).toEqual([]);
    expect(await read(root, `${dir}/Sidebar.tsx`)).toBe(
      componentText(["import styles from './Sidebar.module.css';"], ['export interface SidebarProps {', '  /** @default true */', '  collapsed?: boolean;', '}', '']),
    );
  });

  it('roots the component in the first library layout component when div is not allowed', async () => {
    const layoutComponents = { '@mui/material': ['Box', 'Stack'], html: ['nav'] };
    const { root } = await createComponent('Sidebar', {}, { layoutComponents });
    expect(await read(root, `${dir}/Sidebar.tsx`)).toBe(
      componentText(["import { Box } from '@mui/material';", "import styles from './Sidebar.module.css';"], [], 'Box'),
    );
  });

  it('refuses invalid names, gaps and props, missing features and existing components, writing nothing', async () => {
    const codes = async (name: string, options: Options = {}) => (await createComponent(name, options)).result.issues?.map((issue) => issue.code);
    expect(await codes('2fast')).toEqual(['component-name-invalid']);
    expect(await codes('Sidebar', { interface: 'items NavItem[]' })).toEqual(['props-invalid']);
    expect(await codes('Sidebar', { gap: '8px' })).toEqual(['gap-invalid']);
    expect(await codes('Sidebar', { padding: '1 2 3' })).toEqual(['padding-invalid']);

    const root = await createProject({ ...DOCS, [`${dir}/Sidebar.tsx`]: '' }, { appFiles: 'root' });
    expect((await run(root, 'Sidebar')).issues?.map((issue) => issue.code)).toEqual(['component-exists']);
    expect((await run(root, 'Sidebar', {}, 'blog')).issues?.map((issue) => issue.code)).toEqual(['feature-missing']);
  });

  it('makes the component just a text element with --root, holding its text, with an empty root style', async () => {
    const { root, result } = await createComponent('DocsButton', { app: true, root: 'button', text: 'Read the docs' });
    const docs = 'src/app/components/DocsButton';
    expect(result.ok).toBe(true);
    expect(await read(root, `${docs}/DocsButton.tsx`)).toBe(
      "import styles from './DocsButton.module.css';\n\nexport const DocsButton: React.FC = () => {\n  return <button className={styles.root}>Read the docs</button>;\n};\n",
    );
    expect(await read(root, `${docs}/DocsButton.module.css`)).toBe('.root {\n}\n');
    expect(await issuesOfUsedCode(root)).toEqual([]);

    const tailwind = await createComponent('DocsButton', { app: true, root: 'button' }, { styles: 'tailwind' });
    expect(await read(tailwind.root, `${docs}/DocsButton.styles.ts`)).toBe("export const styles = {\n  root: '',\n};\n");
  });

  it('shows a prop in the text with "{name}", destructuring it', async () => {
    const { root, result } = await createComponent('NavMenu', { app: true, root: 'button', text: 'Open {label}', interface: 'label: string; open?: boolean' });
    expect(result.ok).toBe(true);
    const text = await read(root, 'src/app/components/NavMenu/NavMenu.tsx');
    expect(text).toContain('export const NavMenu: React.FC<NavMenuProps> = ({ label }) => {\n  return <button className={styles.root}>Open {label}</button>;');
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it.each([
    [{ root: 'button', text: '{label}' }, 'value-name-unknown'],
    [{ root: 'button', text: '{label}', interface: 'title: string' }, 'value-name-unknown'],
    [{ root: 'button', text: '{format(label)}', interface: 'label: string' }, 'value-expression-not-allowed'],
  ])('refuses the text of %j', async (options, code) => {
    expect((await createComponent('NavMenu', { app: true, ...options } as Options)).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('accepts a layout element as --root, with its layout', async () => {
    const { root } = await createComponent('Sidebar', { root: 'nav', direction: 'row' });
    expect(await read(root, `${dir}/Sidebar.tsx`)).toContain('return <nav className={styles.root} />;');
    expect(await read(root, `${dir}/Sidebar.module.css`)).toContain('flex-direction: row;');
  });

  it.each([
    [{ root: 'img', text: 'Hi' }, 'root-text-not-allowed'],
    [{ root: 'not a tag' }, 'root-tag-invalid'],
    [{ text: 'Hi' }, 'root-text-not-allowed'],
    [{ root: 'nav', text: 'Hi' }, 'root-text-not-allowed'],
    [{ root: 'img', gap: '2' }, 'layout-not-allowed'],
  ])('refuses %j', async (options, code) => {
    expect((await createComponent('Sidebar', options as Options)).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('creates app components with --app, checked like feature components', async () => {
    const { root, result } = await createComponent('TopBar', { app: true });
    expect(result.summary).toBe('Component "TopBar" created in the app.');
    expect(result.actions?.map((a) => a.path)).toEqual([
      'src/app/components/TopBar/TopBar.tsx',
      'src/app/components/TopBar/TopBar.module.css',
      'src/app/components/TopBar/index.ts',
    ]);
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it('needs exactly one of --feature and --app', async () => {
    const root = await createProject(DOCS, { appFiles: 'root' });
    const codes = async (feature: string | undefined, app: boolean) => {
      const options = { feature, app, type: undefined, interface: undefined, rootProps: undefined, from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: undefined, text: undefined, dryRun: false };
      return (await componentCreateCommand.run({ cwd: root, args: { name: 'TopBar' }, options })).issues?.map((issue) => issue.code);
    };
    expect(await codes(undefined, false)).toEqual(['owner-missing']);
    expect(await codes('docs', true)).toEqual(['options-conflict']);
  });

  it('writes nothing with --dry-run', async () => {
    const { root, result } = await createComponent('Sidebar', { dryRun: true });
    expect(result.actions).toHaveLength(3);
    expect(await exists(root, dir)).toBe(false);
  });
});
