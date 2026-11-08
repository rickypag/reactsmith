import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read, issuesOfUsedCode } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const file = `${dir}/TopBar.tsx`;
const id = 'app/components/TopBar/TopBar.tsx#header';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = {
  [file]: "import styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => {\n  return <header className={styles.root} />;\n};\n",
  [`${dir}/TopBar.module.css`]: '.root {\n  display: flex;\n}\n',
  [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
};

interface Options {
  position?: 'inside' | 'first' | 'before' | 'after';
  text?: string;
  props?: string;
  name?: string;
  direction?: 'row' | 'column';
  gap?: string;
  padding?: string;
}

async function insert(tag: string, into: string, options: Options = {}, tree: Record<string, string> = TOP_BAR, config: object = {}) {
  const root = await createProject(tree, { appFiles: 'app', ...config });
  const result = await elementInsertCommand.run({
    cwd: root,
    args: { name: tag },
    options: {
      around: undefined, through: undefined, if: undefined, fallback: undefined, into,
      position: options.position,
      from: undefined,
      props: options.props,
      text: options.text,
      name: options.name,
      direction: options.direction,
      gap: options.gap,
      align: undefined,
      justify: undefined,
      padding: options.padding,
      each: undefined,
      as: undefined,
      key: undefined,
      dryRun: false,
    },
  });
  return { root, result };
}

describe('element insert', () => {
  it('inserts a text element with its style into a component, which stays valid', async () => {
    const { root, result } = await insert('span', id, { text: 'ReactSmith', name: 'brand' });
    expect(result.ok).toBe(true);
    expect(result.actions).toEqual([
      { type: 'update', path: `${dir}/TopBar.module.css`, message: 'added the rule ".brand"' },
      { type: 'update', path: file, message: 'inserted <span> into #root' },
    ]);
    expect(await read(root, file)).toBe(
      lines(
        "import styles from './TopBar.module.css';",
        '',
        'export const TopBar: React.FC = () => {',
        '  return (',
        '    <header className={styles.root}>',
        '      <span className={styles.brand}>ReactSmith</span>',
        '    </header>',
        '  );',
        '};',
      ),
    );
    expect(await read(root, `${dir}/TopBar.module.css`)).toBe('.root {\n  display: flex;\n}\n\n.brand {\n}\n');
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it('inserts links and layout elements, whose style holds their layout', async () => {
    const tree = { ...TOP_BAR, [file]: TOP_BAR[file]!.replace('<header className={styles.root} />', '<header className={styles.root}>\n      <nav />\n    </header>') };
    const link = await insert('a', `${id}/nav`, { text: 'GitHub', props: 'href="https://github.com/rickypag/reactsmith"' }, tree);
    expect(await read(link.root, file)).toContain('<nav>\n        <a href="https://github.com/rickypag/reactsmith">GitHub</a>\n      </nav>');

    const group = await insert('div', id, { name: 'links', direction: 'row', gap: '4', position: 'first' }, tree);
    expect(await read(group.root, file)).toContain('<header className={styles.root}>\n      <div className={styles.links} />\n      <nav />');
    expect(await read(group.root, `${dir}/TopBar.module.css`)).toContain('.links {\n  display: flex;\n  flex-direction: row;\n  gap: var(--space-4);\n}\n');
  });

  it('writes Tailwind styles, and creates the style file and its import when missing', async () => {
    const plain = { [file]: 'export const TopBar: React.FC = () => <header />;\n', [`${dir}/index.ts`]: TOP_BAR[`${dir}/index.ts`]! };
    const { root } = await insert('div', id, { name: 'links', padding: '2' }, plain, { styles: 'tailwind' });
    expect(await read(root, `${dir}/TopBar.styles.ts`)).toBe("export const styles = {\n  links: 'flex flex-col p-2',\n};\n");
    expect(await read(root, file)).toBe(
      "import { styles } from './TopBar.styles';\n\nexport const TopBar: React.FC = () => <header>\n  <div className={styles.links} />\n</header>;\n",
    );
  });

  it('puts an element next to the root in a fragment, then joins the fragment', async () => {
    const first = await insert('dialog', id, { position: 'after', name: 'edit' });
    expect(first.result.issues).toEqual([]);
    expect(await read(first.root, file)).toBe(
      lines(
        "import styles from './TopBar.module.css';",
        '',
        'export const TopBar: React.FC = () => {',
        '  return (',
        '    <>',
        '      <header className={styles.root} />',
        '      <dialog className={styles.edit} />',
        '    </>',
        '  );',
        '};',
      ),
    );
    expect(await issuesOfUsedCode(first.root)).toEqual([]);
    const tree = { ...TOP_BAR, [file]: await read(first.root, file), [`${dir}/TopBar.module.css`]: await read(first.root, `${dir}/TopBar.module.css`) };
    const second = await insert('span', id, { position: 'before', text: 'Hi' }, tree);
    expect(second.result.issues).toEqual([]);
    expect(await read(second.root, file)).toContain('    <>\n      <span>Hi</span>\n      <header className={styles.root} />\n      <dialog className={styles.edit} />\n    </>');
  });

  it('displays an inserted dialog only while it is open, in CSS Modules and Tailwind', async () => {
    const css = await insert('dialog', id, { name: 'edit', direction: 'column' });
    expect(await read(css.root, `${dir}/TopBar.module.css`)).toBe('.root {\n  display: flex;\n}\n\n.edit {\n  flex-direction: column;\n}\n\n.edit[open] {\n  display: flex;\n}\n');
    const plain = { [file]: 'export const TopBar: React.FC = () => <header />;\n', [`${dir}/index.ts`]: TOP_BAR[`${dir}/index.ts`]! };
    const tailwind = await insert('dialog', id, { name: 'edit', direction: 'column' }, plain, { styles: 'tailwind' });
    expect(await read(tailwind.root, `${dir}/TopBar.styles.ts`)).toBe("export const styles = {\n  edit: 'open:flex flex-col',\n};\n");
  });

  it('uses variables of the file in the text and the link', async () => {
    const tree = {
      ...TOP_BAR,
      [file]: lines(
        "import styles from './TopBar.module.css';",
        "import { SITE } from '@/config';",
        '',
        'export interface TopBarProps {',
        '  user: { name: string };',
        '}',
        '',
        'export const TopBar: React.FC<TopBarProps> = () => {',
        '  return <header className={styles.root} />;',
        '};',
      ),
    };
    const greeting = await insert('span', id, { text: 'Hello, {user.name}! \\{literal\\}' }, tree);
    expect(greeting.result.issues).toEqual([]);
    const text = await read(greeting.root, file);
    expect(text).toContain('= ({ user }) => {');
    expect(text).toContain('<span>Hello, {user.name}{"! {literal}"}</span>');

    // DOCS is an app constant: it gets imported.
    const link = await insert('a', id, { text: '{SITE.name}', props: 'href={`${DOCS}/start`}' }, { ...tree, 'src/app/constants.ts': "export const DOCS = '/docs';\n" });
    const linked = await read(link.root, file);
    expect(linked).toContain('<a href={`${DOCS}/start`}>{SITE.name}</a>');
    expect(linked).toContain("import { SITE } from '@/config';\nimport { DOCS } from '../../constants';\n");
  });

  it.each([
    [{ text: '{label}' }, 'value-name-unknown'],
    [{ text: '{label' }, 'value-brace-unclosed'],
    [{ text: '{a + b}' }, 'value-expression-not-allowed'],
  ])('refuses the text %j', async (options, code) => {
    expect((await insert('span', id, options)).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it.each([
    ['Not-A-Tag', {}, 'element-tag-invalid'],
    ['img', { text: 'Hi' }, 'element-text-not-allowed'],
    ['div', { text: 'Hi' }, 'element-text-not-allowed'],
    ['span', { props: 'href={format(x)}' }, 'value-expression-not-allowed'],
    ['span', { name: 'x', gap: '2' }, 'layout-not-allowed'],
    ['div', { gap: '2' }, 'element-name-required'],
    ['div', { name: 'root' }, 'element-name-invalid'],
  ])('refuses <%s> with %j', async (tag, options, code) => {
    expect((await insert(tag, id, options as Options)).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('refuses taken style names and targets that are not layout elements', async () => {
    const taken = { ...TOP_BAR, [`${dir}/TopBar.module.css`]: '.root {}\n.brand {}\n' };
    expect((await insert('span', id, { name: 'brand' }, taken)).result.issues?.map((issue) => issue.code)).toEqual(['style-name-taken']);
    const text = { ...TOP_BAR, [file]: TOP_BAR[file]!.replace('<header className={styles.root} />', '<header className={styles.root}>\n      <span>Hi</span>\n    </header>') };
    expect((await insert('span', `${id}/span`, { position: 'first' }, text)).result.issues?.map((issue) => issue.code)).toEqual(['insert-target-not-layout']);
  });
});

describe('check: text placement', () => {
  it('reports text outside text elements, in components, views and layouts', async () => {
    const root = await createProject(
      {
        ...TOP_BAR,
        [file]: "import styles from './TopBar.module.css';\nexport const TopBar: React.FC = () => <header className={styles.root}>TopBar<span>ok</span><h1>ok</h1></header>;\n",
        'src/app/views/HomeView/HomeView.tsx': 'export const HomeView: React.FC = () => <main><>Hi</></main>;\n',
        'src/app/views/HomeView/index.ts': "export { HomeView as Component } from './HomeView';\n",
      },
      { appFiles: 'app' },
    );
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code === 'text-outside-text-element');
    expect(issues.map((issue) => issue.message)).toEqual([
      'Text "TopBar" is directly in <header> (line 2), but text belongs in a text element.',
      'Text "Hi" is directly in a fragment (line 1), but text belongs in a text element.',
    ]);
  });
});
