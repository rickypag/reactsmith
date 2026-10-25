import { describe, expect, it } from 'vitest';
import { constantCreateCommand } from '../../src/commands/constant/create/command.js';
import { constantRemoveCommand } from '../../src/commands/constant/remove/command.js';
import { constantUpdateCommand } from '../../src/commands/constant/update/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { toLiteral } from '../../src/shared/constants/literal.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const lines = (...text: string[]) => `${text.join('\n')}\n`;

const SIDEBAR = 'src/app/components/Sidebar';
const SIDEBAR_LINK = 'src/app/components/SidebarLink';
const DOCS = 'src/features/docs';

const TREE = {
  [`${SIDEBAR}/Sidebar.tsx`]: lines(
    "import styles from './Sidebar.module.css';",
    '',
    'export const Sidebar: React.FC = () => {',
    '  return <aside className={styles.root} />;',
    '};',
  ),
  [`${SIDEBAR}/Sidebar.module.css`]: '.root {\n}\n',
  [`${SIDEBAR}/index.ts`]: "export { Sidebar } from './Sidebar';\n",
  [`${SIDEBAR_LINK}/SidebarLink.tsx`]: lines(
    'export interface SidebarLinkProps {',
    '  label: string;',
    '  href: string;',
    '}',
    '',
    'export const SidebarLink: React.FC<SidebarLinkProps> = ({ label, href }) => {',
    '  return <a href={href}>{label}</a>;',
    '};',
  ),
  [`${SIDEBAR_LINK}/index.ts`]: "export { SidebarLink } from './SidebarLink';\n",
  [`${DOCS}/index.ts`]: '',
  [`${DOCS}/views/HomeView/HomeView.tsx`]: 'export const HomeView: React.FC = () => {\n  return <main />;\n};\n',
  [`${DOCS}/views/HomeView/index.ts`]: "export { HomeView as Component } from './HomeView';\n",
};

interface Options {
  app?: boolean;
  feature?: string;
  component?: string;
  value?: string;
  file?: string;
}

const owner = (options: Options) => ({ app: options.app ?? false, feature: options.feature, component: options.component });

const create = (root: string, name: string, options: Options) =>
  constantCreateCommand.run({ cwd: root, args: { name }, options: { ...owner(options), value: options.value, file: options.file, dryRun: false } });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('toLiteral', () => {
  it('writes JSON as TypeScript, inline when short and one item per line when long', () => {
    expect(toLiteral({ label: "It's", 'data-x': [1, true, null] })).toBe("{ label: 'It\\'s', 'data-x': [1, true, null] }");
    const pages = [
      { label: 'Introduction', href: '/' },
      { label: 'Why Apollo?', href: '/why-apollo' },
    ];
    expect(toLiteral(pages)).toBe("[\n  { label: 'Introduction', href: '/' },\n  { label: 'Why Apollo?', href: '/why-apollo' },\n]");
  });
});

describe('constant create', () => {
  it('creates the app constants file, then adds to it, and passes check', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    const first = await create(root, 'SITE_NAME', { app: true, value: '"Apollo Docs"' });
    expect(first.actions).toEqual([{ type: 'create', path: 'src/app/constants.ts', message: 'constants, with "SITE_NAME"' }]);
    await create(root, 'PAGE_SIZE', { app: true, value: '20' });
    expect(await read(root, 'src/app/constants.ts')).toBe("export const SITE_NAME = 'Apollo Docs';\n\nexport const PAGE_SIZE = 20;\n");
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('writes to a feature or a component, and reads the value from a file', async () => {
    const root = await createProject({ ...TREE, 'navigation.json': '[{"label":"Home","href":"/"}]' }, { appFiles: 'app' });
    await create(root, 'NAVIGATION', { feature: 'docs', file: 'navigation.json' });
    expect(await read(root, `${DOCS}/constants.ts`)).toBe("export const NAVIGATION = [{ label: 'Home', href: '/' }];\n");
    await create(root, 'WIDTH', { component: 'app/components/Sidebar', value: '"15rem"' });
    expect(await read(root, `${SIDEBAR}/constants.ts`)).toBe("export const WIDTH = '15rem';\n");
  });

  it('refuses names used anywhere in the project, bad values and unknown places', async () => {
    const root = await createProject({ ...TREE, 'src/app/constants.ts': 'export const TITLE = 1;\n' }, { appFiles: 'app' });
    expect(codes(await create(root, 'TITLE', { app: true, value: '2' }))).toEqual(['constant-exists']);
    expect(codes(await create(root, 'TITLE', { feature: 'docs', value: '2' }))).toEqual(['constant-name-taken']);
    expect(codes(await create(root, 'X', { app: true, value: 'Apollo' }))).toEqual(['constant-value-invalid']);
    expect(codes(await create(root, 'X', { app: true }))).toEqual(['constant-value-missing']);
    expect(codes(await create(root, 'X', { feature: 'blog', value: '1' }))).toEqual(['feature-missing']);
    expect(codes(await create(root, 'X', { component: 'app/components/Nope', value: '1' }))).toEqual(['component-missing']);
    expect(codes(await create(root, 'X', { app: true, feature: 'docs', value: '1' }))).toEqual(['options-conflict']);
    expect(codes(await create(root, 'my-name', { app: true, value: '1' }))).toEqual(['constant-name-invalid']);
  });
});

describe('constant update and remove', () => {
  it('replaces the value, keeping the rest of the file', async () => {
    const root = await createProject({ ...TREE, 'src/app/constants.ts': 'export const A = 1;\n\nexport const B = 2;\n' }, { appFiles: 'app' });
    await constantUpdateCommand.run({ cwd: root, args: { name: 'A' }, options: { ...owner({ app: true }), value: '["x"]', file: undefined, dryRun: false } });
    expect(await read(root, 'src/app/constants.ts')).toBe("export const A = ['x'];\n\nexport const B = 2;\n");
  });

  it('removes an unused constant, and the file with its last one, but not one in use', async () => {
    const root = await createProject(
      {
        ...TREE,
        'src/app/constants.ts': 'export const A = 1;\n\nexport const B = 2;\n',
        [`${SIDEBAR}/Sidebar.tsx`]: TREE[`${SIDEBAR}/Sidebar.tsx`]!.replace("import styles from './Sidebar.module.css';", "import styles from './Sidebar.module.css';\nimport { B } from '../../constants';"),
      },
      { appFiles: 'app' },
    );
    const remove = (name: string) => constantRemoveCommand.run({ cwd: root, args: { name }, options: { ...owner({ app: true }), dryRun: false } });

    const inUse = await remove('B');
    expect(inUse.issues?.map((issue) => issue.message)).toEqual([`The constant "B" is used in ${SIDEBAR}/Sidebar.tsx.`]);
    await remove('A');
    expect(await read(root, 'src/app/constants.ts')).toBe('export const B = 2;\n');
  });

  it('deletes the constants file with its last constant', async () => {
    const root = await createProject({ ...TREE, 'src/app/constants.ts': 'export const A = 1;\n' }, { appFiles: 'app' });
    const result = await constantRemoveCommand.run({ cwd: root, args: { name: 'A' }, options: { ...owner({ app: true }), dryRun: false } });
    expect(result.actions).toEqual([{ type: 'delete', path: 'src/app/constants.ts', message: 'removed "A", its last constant' }]);
    expect(await exists(root, 'src/app/constants.ts')).toBe(false);
  });
});

describe('using constants', () => {
  const PAGES = '[{"label":"Home","href":"/"}]';

  it('imports an app constant used by a list, without touching the code by hand', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    await create(root, 'PAGES', { app: true, value: PAGES });
    const result = await elementInsertCommand.run({
      cwd: root,
      args: { name: 'SidebarLink' },
      options: { into: 'app/components/Sidebar/Sidebar.tsx#aside', position: undefined, from: undefined, props: '{...page}', text: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: 'PAGES', as: 'page', key: 'page.href', dryRun: false },
    });
    expect(result.issues).toEqual([]);
    const text = await read(root, `${SIDEBAR}/Sidebar.tsx`);
    expect(text).toContain("import { PAGES } from '../../constants';");
    expect(text).toContain('{PAGES.map((page) => <SidebarLink key={page.href} {...page} />)}');
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('prefers the nearest constants file, and adds to an existing import of it', async () => {
    const root = await createProject(
      { ...TREE, [`${SIDEBAR}/constants.ts`]: "export const A = 'a';\nexport const B = 'b';\n" },
      { appFiles: 'app' },
    );
    const insert = (text: string) =>
      elementInsertCommand.run({
        cwd: root,
        args: { name: 'span' },
        options: { into: 'app/components/Sidebar/Sidebar.tsx#aside', position: undefined, from: undefined, props: undefined, text, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
      });
    await insert('{A}');
    await insert('{B}');
    expect(await read(root, `${SIDEBAR}/Sidebar.tsx`)).toContain("import { A, B } from './constants';");
  });

  it('imports feature constants inside the feature, and app constants only when features may import the app', async () => {
    const root = await createProject(
      { ...TREE, [`${DOCS}/constants.ts`]: "export const TITLE = 'Docs';\n", 'src/app/constants.ts': "export const SITE = 'Apollo';\n" },
      { appFiles: 'app' },
    );
    const insert = (text: string) =>
      elementInsertCommand.run({
        cwd: root,
        args: { name: 'h1' },
        options: { into: 'features/docs/views/HomeView/HomeView.tsx#main', position: undefined, from: undefined, props: undefined, text, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
      });
    expect((await insert('{TITLE}')).issues).toEqual([]);
    expect(await read(root, `${DOCS}/views/HomeView/HomeView.tsx`)).toContain("import { TITLE } from '../../constants';");
    expect(codes(await insert('{SITE}'))).toEqual(['value-name-unknown']);
  });
});

describe('check: constants files', () => {
  it('allows only exported constants holding plain data', async () => {
    const root = await createProject(
      {
        ...TREE,
        'src/app/constants.ts': lines(
          "import { x } from './x';",
          'export const OK = { a: [1, -2, "b", null] };',
          'export const NOW = Date.now();',
          'const HIDDEN = 1;',
          'export function f() {}',
        ),
      },
      { appFiles: 'app' },
    );
    const messages = (await checkStructure(root)).issues.filter((issue) => issue.code === 'constants-file-content').map((issue) => issue.message);
    expect(messages).toEqual([
      'Line 1 is not an exported constant: a constants file only holds "export const NAME = …".',
      'The constant "NOW" (line 3) is not plain data: only strings, numbers, booleans, null, arrays and objects.',
      'Line 4 is not an exported constant: a constants file only holds "export const NAME = …".',
      'Line 5 is not an exported constant: a constants file only holds "export const NAME = …".',
    ]);
  });
});
