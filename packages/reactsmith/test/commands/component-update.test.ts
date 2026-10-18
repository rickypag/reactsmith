import { describe, expect, it } from 'vitest';
import { componentUpdateCommand } from '../../src/commands/component/update/command.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR_CSS = lines(
  '.root {',
  '  display: flex;',
  '  flex-direction: row;',
  '  gap: var(--space-2);',
  '  align-items: center;',
  '  padding: 0 var(--space-4);',
  '  height: 3.5rem;',
  '  font-weight: 600;',
  '}',
);

interface Options {
  direction?: 'row' | 'column' | 'none';
  gap?: string;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'none';
  justify?: 'start' | 'center' | 'end' | 'between' | 'none';
  padding?: string;
  css?: string;
  cssFile?: string;
  dryRun?: boolean;
}

async function update(options: Options, style: { file: string; text: string } = { file: 'TopBar.module.css', text: TOP_BAR_CSS }, config: object = {}) {
  const root = await createProject(
    {
      [`${dir}/TopBar.tsx`]: "import styles from './TopBar.module.css';\nexport const TopBar: React.FC = () => <header className={styles.root} />;\n",
      [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
      [`${dir}/${style.file}`]: style.text,
    },
    { appFiles: 'app', ...config },
  );
  const result = await componentUpdateCommand.run({
    cwd: root,
    args: { name: 'TopBar' },
    options: {
      feature: undefined,
      app: true,
      direction: options.direction,
      gap: options.gap,
      align: options.align,
      justify: options.justify,
      padding: options.padding,
      css: options.css,
      cssFile: options.cssFile,
      dryRun: options.dryRun ?? false,
    },
  });
  return { result, text: await read(root, `${dir}/${style.file}`) };
}

describe('component update: CSS Modules', () => {
  it('changes, adds and removes only the given styles, keeping the others as written', async () => {
    const { result, text } = await update({ direction: 'column', gap: '4', justify: 'between', align: 'none', padding: '3' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Updated the root style of "TopBar" in the app.');
    expect(result.actions).toEqual([
      {
        type: 'update',
        path: `${dir}/TopBar.module.css`,
        message: 'root style: direction column, gap var(--space-4), align removed, justify space-between, padding var(--space-3)',
      },
    ]);
    expect(text).toBe(
      lines(
        '.root {',
        '  display: flex;',
        '  flex-direction: column;',
        '  gap: var(--space-4);',
        '  padding: var(--space-3);',
        '  height: 3.5rem;',
        '  font-weight: 600;',
        '  justify-content: space-between;',
        '}',
      ),
    );
  });

  it('adds display: flex when a layout style is set without it, and skips when nothing changes', async () => {
    const plain = { file: 'TopBar.module.css', text: '.root {\n  color: red;\n}\n' };
    expect((await update({ gap: '2' }, plain)).text).toBe('.root {\n  display: flex;\n  color: red;\n  gap: var(--space-2);\n}\n');
    expect((await update({ padding: '2' }, plain)).text).toBe('.root {\n  color: red;\n  padding: var(--space-2);\n}\n');

    const same = await update({ gap: '2' });
    expect(same.result.actions).toEqual([{ type: 'skip', path: `${dir}/TopBar.module.css`, message: 'root style already has gap var(--space-2)' }]);
  });
});

describe('component update: Tailwind', () => {
  it('swaps only the managed classes, in place', async () => {
    const tailwind = { file: 'TopBar.styles.ts', text: "export const styles = {\n  root: 'flex flex-row gap-2 items-center py-0 px-4 h-14 border-b',\n};\n" };
    const { text } = await update({ direction: 'column', padding: '4', align: 'none', justify: 'between' }, tailwind, { styles: 'tailwind' });
    expect(text).toBe("export const styles = {\n  root: 'flex flex-col gap-2 p-4 h-14 border-b justify-between',\n};\n");
  });
});

describe('component update: CSS declarations', () => {
  const DESIGN = `{
  display: inline-flex;
  align-items: center;
  gap: 9px;
  background: var(--rs-ink);
  color: var(--background);
  border-radius: 7px;
  padding: 10px 14px;
  font-weight: 650;
  font-size: 12px;
}`;

  it('sets the declarations as given, replacing the same properties and keeping the others', async () => {
    const { result, text } = await update({ css: DESIGN });
    expect(result.actions?.[0]?.message).toBe(
      'root style: css display, align-items, gap, background, color, border-radius, padding, font-weight, font-size',
    );
    expect(text).toBe(
      lines(
        '.root {',
        '  display: inline-flex;',
        '  flex-direction: row;',
        '  gap: 9px;',
        '  align-items: center;',
        '  padding: 10px 14px;',
        '  height: 3.5rem;',
        '  font-weight: 650;',
        '  background: var(--rs-ink);',
        '  color: var(--background);',
        '  border-radius: 7px;',
        '  font-size: 12px;',
        '}',
      ),
    );
  });

  it('fills an empty root rule, with declarations read from a file', async () => {
    const root = await createProject(
      {
        [`${dir}/TopBar.tsx`]: "import styles from './TopBar.module.css';\nexport const TopBar: React.FC = () => <header className={styles.root} />;\n",
        [`${dir}/TopBar.module.css`]: '.root {}\n',
        'design/button.css': '/* from the design team */\n{\n  color: red;\n  border-radius: 7px;\n}\n',
      },
      { appFiles: 'app' },
    );
    const run = (cssFile: string) =>
      componentUpdateCommand.run({
        cwd: root,
        args: { name: 'TopBar' },
        options: { feature: undefined, app: true, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, css: undefined, cssFile, dryRun: false },
      });
    expect((await run('design/button.css')).ok).toBe(true);
    expect(await read(root, `${dir}/TopBar.module.css`)).toBe('.root {\n  color: red;\n  border-radius: 7px;\n}\n');
    expect((await run('design/missing.css')).issues?.map((issue) => issue.code)).toEqual(['css-file-missing']);
  });

  it('writes Tailwind arbitrary properties, replacing classes for the same property', async () => {
    const tailwind = { file: 'TopBar.styles.ts', text: "export const styles = {\n  root: 'flex flex-row gap-2 items-center px-4 h-14 [color:blue]',\n};\n" };
    const { text } = await update({ css: 'display: inline-flex; gap: 9px; padding: 10px 14px; color: var(--background)' }, tailwind, { styles: 'tailwind' });
    expect(text).toBe("export const styles = {\n  root: 'flex-row items-center h-14 [display:inline-flex] [gap:9px] [padding:10px_14px] [color:var(--background)]',\n};\n");
  });

  it.each([
    ['.btn { color: red }', 'css-invalid'],
    ['color red', 'css-invalid'],
    ['   ', 'css-invalid'],
  ])('refuses %j', async (css, code) => {
    expect((await update({ css })).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });
});

describe('component update: errors', () => {
  it.each([
    [{}, 'update-nothing'],
    [{ gap: 'big' }, 'gap-invalid'],
    [{ padding: '1 2 3' }, 'padding-invalid'],
  ])('refuses %j', async (options, code) => {
    expect((await update(options as Options)).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('refuses a style file without a root style', async () => {
    const { result } = await update({ gap: '2' }, { file: 'TopBar.module.css', text: '.title {}\n' });
    expect(result.issues?.map((issue) => issue.code)).toEqual(['root-style-missing']);
  });

  it('writes nothing with --dry-run', async () => {
    const { result, text } = await update({ gap: '4', dryRun: true });
    expect(result.actions).toHaveLength(1);
    expect(text).toBe(TOP_BAR_CSS);
  });
});
