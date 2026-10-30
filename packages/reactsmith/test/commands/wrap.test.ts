import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { elementRemoveCommand } from '../../src/commands/element/remove/command.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/layouts/RootLayout';
const file = `${dir}/RootLayout.tsx`;
const css = `${dir}/RootLayout.module.css`;
const id = 'app/layouts/RootLayout/RootLayout.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const ROOT_LAYOUT = lines(
  "import { Outlet } from 'react-router';",
  "import { Sidebar } from '../../components/Sidebar';",
  "import styles from './RootLayout.module.css';",
  '',
  'export const RootLayout: React.FC = () => {',
  '  return (',
  '    <div className={styles.root}>',
  '      <Sidebar />',
  '      <main className={styles.main}>',
  '        <Outlet />',
  '        <button className={styles.help}>Help</button>',
  '      </main>',
  '    </div>',
  '  );',
  '};',
);
const ROOT_LAYOUT_CSS = '.root {\n  display: flex;\n}\n\n.main {\n  flex: 1;\n}\n\n.help {\n}\n';

async function project(text = ROOT_LAYOUT) {
  return createProject(
    {
      [file]: text,
      [css]: ROOT_LAYOUT_CSS,
      [`${dir}/index.ts`]: "export { RootLayout } from './RootLayout';\n",
      'src/app/components/Sidebar/Sidebar.tsx': "export const Sidebar: React.FC = () => <aside />;\n",
      'src/app/components/Sidebar/index.ts': "export { Sidebar } from './Sidebar';\n",
    },
    { appFiles: 'app' },
  );
}

interface WrapOptions {
  through?: string;
  name?: string;
  direction?: 'row' | 'column';
  text?: string;
  position?: 'first';
  into?: string;
}

async function wrap(root: string, tag: string, around: string | undefined, options: WrapOptions = {}) {
  return elementInsertCommand.run({
    cwd: root,
    args: { name: tag },
    options: { around, through: options.through, if: undefined, fallback: undefined, into: options.into, position: options.position, from: undefined, props: undefined, text: options.text, name: options.name, direction: options.direction, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });
}

const unwrap = (root: string, target: string) => elementRemoveCommand.run({ cwd: root, args: { target }, options: { keepChildren: true, dryRun: false } });
const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('element insert --around: wrapping', () => {
  it('wraps siblings in a new layout element, re-indented, with its style', async () => {
    const root = await project();
    const result = await wrap(root, 'div', `${id}#root/Sidebar`, { through: `${id}#main`, name: 'body', direction: 'row' });
    expect(result.issues).toEqual([]);
    expect(result.data).toMatchObject({ id: `${id}#body` });
    expect(await read(root, file)).toContain(
      lines(
        '    <div className={styles.root}>',
        '      <div className={styles.body}>',
        '        <Sidebar />',
        '        <main className={styles.main}>',
        '          <Outlet />',
        '          <button className={styles.help}>Help</button>',
        '        </main>',
        '      </div>',
        '    </div>',
      ),
    );
    expect(await read(root, css)).toContain('.body {\n  display: flex;\n  flex-direction: row;');
  });

  it('wraps one element, and takes the siblings in the order of the code', async () => {
    const root = await project();
    expect(codes(await wrap(root, 'section', `${id}#main`, { through: `${id}#root/Sidebar` }))).toEqual([]);
    expect(await read(root, file)).toContain('    <div className={styles.root}>\n      <section>\n        <Sidebar />');
    const single = await project();
    expect(codes(await wrap(single, 'nav', `${id}#help`))).toEqual([]);
    expect(await read(single, file)).toContain('        <nav>\n          <button className={styles.help}>Help</button>\n        </nav>\n');
  });

  it('refuses the root, elements of different parents, and a wrapper that holds no elements', async () => {
    const root = await project();
    expect(codes(await wrap(root, 'div', `${id}#root`))).toEqual(['wrap-root']);
    expect(codes(await wrap(root, 'div', `${id}#root/Sidebar`, { through: `${id}#help` }))).toEqual(['wrap-not-siblings']);
    expect(codes(await wrap(root, 'span', `${id}#root/Sidebar`))).toEqual(['wrap-not-container']);
    expect(await read(root, file)).toBe(ROOT_LAYOUT);
  });

  it('refuses options that do not go with wrapping', async () => {
    const root = await project();
    expect(codes(await wrap(root, 'div', `${id}#main`, { text: 'Hi' }))).toEqual(['options-conflict']);
    expect(codes(await wrap(root, 'div', `${id}#main`, { position: 'first' }))).toEqual(['options-conflict']);
    expect(codes(await wrap(root, 'div', `${id}#main`, { into: `${id}#root` }))).toEqual(['options-conflict']);
    expect(codes(await wrap(root, 'div', undefined))).toEqual(['options-conflict']);
  });
});

describe('element remove --keep-children: unwrapping', () => {
  it('undoes a wrap: the content takes its place, and the unused style goes', async () => {
    const root = await project();
    await wrap(root, 'div', `${id}#root/Sidebar`, { through: `${id}#main`, name: 'body', direction: 'row' });
    const result = await unwrap(root, `${id}#body`);
    expect(result.issues).toEqual([]);
    // What was dropped comes before "keeping its content", so the style doesn't read as kept.
    expect(result.actions?.at(-1)?.message).toMatch(/^removed <div> from #root( and the style "body")?, keeping its content$/);
    expect(await read(root, file)).toBe(ROOT_LAYOUT);
    expect(await read(root, css)).toBe(ROOT_LAYOUT_CSS);
  });

  it('refuses the root, a list, and text that its parent cannot hold', async () => {
    const root = await project();
    expect(codes(await unwrap(root, `${id}#root`))).toEqual(['remove-root-keep-children']);
    expect(codes(await unwrap(root, `${id}#help`))).toEqual(['remove-children-not-allowed']);
    const list = await project(ROOT_LAYOUT.replace('<Outlet />', '{LINKS.map((link) => <Sidebar key={link} />)}'));
    expect(codes(await unwrap(list, `${id}#main/{LINKS}`))).toEqual(['remove-list-keep-children']);
    expect(await read(root, file)).toBe(ROOT_LAYOUT);
  });
});
