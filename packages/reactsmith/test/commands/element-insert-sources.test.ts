import { symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { elementUpdateCommand } from '../../src/commands/element/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const file = 'src/app/components/TopBar/TopBar.tsx';
const id = 'app/components/TopBar/TopBar.tsx#header';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = {
  [file]: "import styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => {\n  return <header className={styles.root} />;\n};\n",
  'src/app/components/TopBar/TopBar.module.css': '.root {\n}\n',
  'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
};

/** A package in node_modules with types exporting `names`. */
function fakePackage(name: string, names: string[]): Record<string, string> {
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify({ name, types: 'index.d.ts' }),
    [`node_modules/${name}/index.d.ts`]: names.map((exported) => `export declare const ${exported}: (props: Record<string, unknown>) => null;`).join('\n'),
  };
}

interface Options {
  into?: string;
  from?: string;
  props?: string;
  text?: string;
  name?: string;
}

async function insertInto(root: string, name: string, options: Options = {}) {
  return elementInsertCommand.run({
    cwd: root,
    args: { name },
    options: {
      around: undefined, through: undefined, if: undefined, fallback: undefined, into: options.into ?? id,
      position: undefined,
      from: options.from,
      props: options.props,
      text: options.text, message: undefined,
      name: options.name,
      direction: undefined,
      gap: undefined,
      align: undefined,
      justify: undefined,
      padding: undefined,
      each: undefined,
      as: undefined,
      key: undefined,
      dryRun: false,
    },
  });
}

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('element insert: where a component comes from', () => {
  const PACKAGES = {
    ...fakePackage('fake-ui', ['Tooltip', 'Link']),
    ...fakePackage('other-ui', ['Link']),
    'package.json': JSON.stringify({ dependencies: { 'fake-ui': '1.0.0', 'other-ui': '1.0.0' } }),
  };

  it('imports a component from the only dependency that exports it', async () => {
    const root = await createProject({ ...TOP_BAR, ...PACKAGES }, { appFiles: 'app' });
    const result = await insertInto(root, 'Tooltip', { props: 'title="Hi"' });
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'inserted <Tooltip> into #root and its import from "fake-ui"' }]);
    const text = await read(root, file);
    expect(text).toContain("import { Tooltip } from 'fake-ui';");
    expect(text).toContain('<Tooltip title="Hi" />');
  });

  it('asks for --from when several sources export the name', async () => {
    const root = await createProject({ ...TOP_BAR, ...PACKAGES }, { appFiles: 'app' });
    const ambiguous = await insertInto(root, 'Link');
    expect(ambiguous.issues?.map((issue) => issue.message)).toEqual(['"Link" is in fake-ui, other-ui.']);
    expect((await insertInto(root, 'Link', { from: 'other-ui' })).issues).toEqual([]);
    expect(await read(root, file)).toContain("import { Link } from 'other-ui';");
  });

  it('refuses names nothing exports, and --from on HTML tags', async () => {
    const root = await createProject({ ...TOP_BAR, ...PACKAGES }, { appFiles: 'app' });
    expect(codes(await insertInto(root, 'Missing'))).toEqual(['element-source-missing']);
    expect(codes(await insertInto(root, 'Tooltip', { from: 'other-ui' }))).toEqual(['element-source-missing']);
    expect(codes(await insertInto(root, 'div', { from: 'fake-ui' }))).toEqual(['options-conflict']);
  });

  it('leaves the icon library out of the search', async () => {
    const root = await createProject({ ...TOP_BAR, ...PACKAGES, ...fakePackage('lucide-react', ['Tooltip']), 'package.json': JSON.stringify({ dependencies: { 'fake-ui': '1', 'lucide-react': '1' } }) }, { appFiles: 'app', icons: { library: 'lucide-react' } });
    expect((await insertInto(root, 'Tooltip')).issues).toEqual([]);
    expect(await read(root, file)).toContain("import { Tooltip } from 'fake-ui';");
  });
});

describe('interactive elements', () => {
  it('hold text and other elements', async () => {
    const root = await createProject(TOP_BAR, { appFiles: 'app' });
    expect((await insertInto(root, 'a', { props: 'href="/"' })).issues).toEqual([]);
    expect((await insertInto(root, 'span', { into: `${id}/a`, text: 'APOLLO' })).issues).toEqual([]);
    expect((await insertInto(root, 'span', { into: `${id}/a`, text: 'DOCS' })).issues).toEqual([]);
    expect(await read(root, file)).toContain('<a href="/">\n        <span>APOLLO</span>\n        <span>DOCS</span>\n      </a>');
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('include the router links, imported from the router', async () => {
    const root = await createProject({ ...TOP_BAR, ...fakePackage('react-router', ['NavLink', 'Link']), 'package.json': JSON.stringify({ dependencies: { 'react-router': '7' } }) }, {
      appFiles: 'app',
      router: { library: 'react-router', version: 7, mode: 'data' },
    });
    expect((await insertInto(root, 'NavLink', { props: 'to="/docs"', text: 'Docs' })).issues).toEqual([]);
    const text = await read(root, file);
    expect(text).toContain("import { NavLink } from 'react-router';");
    expect(text).toContain('<NavLink to="/docs">Docs</NavLink>');
  });
});

describe('TypeScript as the reference for props', () => {
  /** A project that sees the repo's installed React and React Router types, through a junction to node_modules. */
  async function typedProject(tree: Record<string, string>, config: object = {}) {
    const root = await createProject(
      {
        ...tree,
        'package.json': JSON.stringify({ dependencies: { react: '19', 'react-router': '7' } }),
        'tsconfig.app.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, lib: ['ES2022', 'DOM'] }, include: ['src'] }),
      },
      { appFiles: 'app', router: { library: 'react-router', version: 7, mode: 'data' }, ...config },
    );
    const modules = path.join(root, 'node_modules');
    await symlink(fileURLToPath(new URL('../../../../node_modules', import.meta.url)), modules, 'junction');
    return { root, unlinkModules: () => unlink(modules) };
  }

  it('refuses props an element does not take, and accepts the right ones', async () => {
    const { root, unlinkModules } = await typedProject(TOP_BAR);
    try {
      const wrong = await insertInto(root, 'NavLink', { props: 'href="/docs"', text: 'Docs' });
      expect(codes(wrong)).toEqual(['element-props-invalid']);
      expect(wrong.issues?.[0]?.message).toContain("Property 'href' does not exist");
      expect(codes(await insertInto(root, 'a', { props: 'to="/docs"', text: 'Docs' }))).toEqual(['element-props-invalid']);

      expect((await insertInto(root, 'NavLink', { props: 'to="/docs"', text: 'Docs' })).issues).toEqual([]);
      const link = 'app/components/TopBar/TopBar.tsx#header/NavLink';
      const update = (props: string) => elementUpdateCommand.run({ cwd: root, args: { target: link }, options: { text: undefined, message: undefined, props, removeProps: undefined, dryRun: false } });
      expect(codes(await update('href="/x"'))).toEqual(['element-props-invalid']);
      expect((await update('to="/guide" end')).issues).toEqual([]);
      expect(await read(root, file)).toContain('<NavLink to="/guide" end>Docs</NavLink>');
    } finally {
      await unlinkModules();
    }
  }, 30_000);

  it('checks the props of a component root', async () => {
    const { root, unlinkModules } = await typedProject(TOP_BAR);
    try {
      const create = (name: string, props: string) =>
        componentCreateCommand.run({
          cwd: root,
          args: { name },
          options: { feature: undefined, app: true, type: undefined, interface: 'label: string; href: string', root: 'NavLink', from: undefined, rootProps: props, text: '{label}', direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, jsx: undefined, replace: false, dryRun: false },
        });
      expect(codes(await create('BadLink', 'href={href}'))).toEqual(['element-props-invalid']);
      expect((await create('SidebarLink', 'to={href}')).issues).toEqual([]);
      expect(await read(root, 'src/app/components/SidebarLink/SidebarLink.tsx')).toBe(
        lines(
          "import { NavLink } from 'react-router';",
          "import styles from './SidebarLink.module.css';",
          '',
          'export interface SidebarLinkProps {',
          '  label: string;',
          '  href: string;',
          '}',
          '',
          'export const SidebarLink: React.FC<SidebarLinkProps> = ({ label, href }) => {',
          '  return <NavLink className={styles.root} to={href}>{label}</NavLink>;',
          '};',
        ),
      );
    } finally {
      await unlinkModules();
    }
  }, 30_000);

  it('checks a named element against its new Tailwind style', async () => {
    const tailwind = {
      [file]: "import { styles } from './TopBar.styles';\n\nexport const TopBar: React.FC = () => {\n  return <header className={styles.root} />;\n};\n",
      'src/app/components/TopBar/TopBar.styles.ts': "export const styles = {\n  root: 'flex',\n};\n",
      'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
    };
    const { root, unlinkModules } = await typedProject(tailwind, { styles: 'tailwind' });
    try {
      expect((await insertInto(root, 'a', { props: "href='/'", name: 'brand' })).issues).toEqual([]);
      expect(await read(root, file)).toContain("<a className={styles.brand} href='/' />");
    } finally {
      await unlinkModules();
    }
  }, 30_000);
  it('wraps elements in a package component whose types take children, e.g. Suspense, and inserts into it after', async () => {
    const tree = {
      ...TOP_BAR,
      [file]: lines("import styles from './TopBar.module.css';", '', 'export const TopBar: React.FC = () => {', '  return (', '    <header className={styles.root}>', '      <nav className={styles.links} />', '    </header>', '  );', '};'),
    };
    const { root, unlinkModules } = await typedProject(tree);
    try {
      const wrapped = await elementInsertCommand.run({
        cwd: root,
        args: { name: 'Suspense' },
        options: { around: 'app/components/TopBar/TopBar.tsx#links', through: undefined, if: undefined, fallback: undefined, into: undefined, position: undefined, from: 'react', props: undefined, text: undefined, message: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
      });
      expect(wrapped.issues).toEqual([]);
      const text = await read(root, file);
      expect(text).toContain("import { Suspense } from 'react';");
      expect(text).toMatch(/<Suspense>\s*<nav className=\{styles\.links\} \/>\s*<\/Suspense>/);
      // Written around elements, it holds them: another goes in.
      expect((await insertInto(root, 'span', { into: 'app/components/TopBar/TopBar.tsx#header/Suspense', text: 'Loading' })).issues).toEqual([]);
      expect(await read(root, file)).toContain('<span>Loading</span>');
    } finally {
      await unlinkModules();
    }
  }, 30_000);
});
