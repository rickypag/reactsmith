import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

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
  href?: string;
  name?: string;
  direction?: 'row' | 'column';
  gap?: string;
  padding?: string;
}

async function insert(tag: string, into: string, options: Options = {}, tree: Record<string, string> = TOP_BAR, config: object = {}) {
  const root = await createProject(tree, { appFiles: 'app', ...config });
  const result = await elementInsertCommand.run({
    cwd: root,
    args: { tag },
    options: {
      into,
      position: options.position,
      text: options.text,
      href: options.href,
      name: options.name,
      direction: options.direction,
      gap: options.gap,
      align: undefined,
      justify: undefined,
      padding: options.padding,
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
      { type: 'update', path: file, message: 'inserted <span> into header' },
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
    expect((await checkStructure(root)).issues).toEqual([]);
  });

  it('inserts links and layout elements, whose style holds their layout', async () => {
    const tree = { ...TOP_BAR, [file]: TOP_BAR[file]!.replace('<header className={styles.root} />', '<header className={styles.root}>\n      <nav />\n    </header>') };
    const link = await insert('a', `${id}/nav`, { text: 'GitHub', href: 'https://github.com/rickypag/reactsmith' }, tree);
    expect(await read(link.root, file)).toContain('<nav>\n        <a href="https://github.com/rickypag/reactsmith">GitHub</a>\n      </nav>');

    const group = await insert('div', id, { name: 'links', direction: 'row', gap: '4', position: 'first' }, tree);
    expect(await read(group.root, file)).toContain('<header className={styles.root}>\n      <div className={styles.links} />\n      <nav />');
    expect(await read(group.root, `${dir}/TopBar.module.css`)).toContain('.links {\n  display: flex;\n  flex-direction: row;\n  gap: var(--space-4);\n}\n');
  });

  it('writes Tailwind styles, and creates the style file and its import when missing', async () => {
    const plain = { [file]: 'export const TopBar: React.FC = () => <header />;\n', [`${dir}/index.ts`]: TOP_BAR[`${dir}/index.ts`]! };
    const { root } = await insert('div', id, { name: 'links', padding: '2' }, plain, { styles: 'tailwind' });
    expect(await read(root, `${dir}/TopBar.styles.ts`)).toBe("export const styles = {\n  links: 'flex flex-col gap-2 p-2',\n};\n");
    expect(await read(root, file)).toBe(
      "import { styles } from './TopBar.styles';\n\nexport const TopBar: React.FC = () => <header>\n  <div className={styles.links} />\n</header>;\n",
    );
  });

  it.each([
    ['img', {}, 'element-tag-not-allowed'],
    ['div', { text: 'Hi' }, 'element-text-not-allowed'],
    ['span', { href: '/' }, 'element-href-not-allowed'],
    ['span', { name: 'x', gap: '2' }, 'element-layout-not-allowed'],
    ['div', { gap: '2' }, 'element-name-required'],
    ['div', { name: 'root' }, 'element-name-invalid'],
  ])('refuses <%s> with %j', async (tag, options, code) => {
    expect((await insert(tag, id, options as Options)).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('refuses taken style names and targets that are not layout elements', async () => {
    const taken = { ...TOP_BAR, [`${dir}/TopBar.module.css`]: '.root {}\n.brand {}\n' };
    expect((await insert('span', id, { name: 'brand' }, taken)).result.issues?.map((issue) => issue.code)).toEqual(['style-name-taken']);
    expect((await insert('span', id, { position: 'after' })).result.issues?.map((issue) => issue.code)).toEqual(['insert-target-not-layout']);
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
      'Text "Hi" is directly in a fragment (line 1), but text belongs in a text element.',
      'Text "TopBar" is directly in <header> (line 2), but text belongs in a text element.',
    ]);
  });
});
