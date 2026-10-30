import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { idCommand } from '../../src/commands/id/command.js';
import { loadConfig } from '../../src/shared/config/load.js';
import { resolveTarget } from '../../src/shared/elements/ids.js';
import { createProject } from '../helpers.js';

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const file = 'src/app/components/TopBar/TopBar.tsx';
const ids = 'app/components/TopBar/TopBar.tsx';

const TOP_BAR = lines(
  "import styles from './TopBar.module.css';",
  '',
  'export const TopBar: React.FC = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <div className={styles.start} />',
  '      <div className={styles.end}>',
  '        <button className={styles.search}>Search</button>',
  '        <button>Theme</button>',
  '        <button className={styles.signIn}>Sign In</button>',
  '        <a className={styles.link}>One</a>',
  '        <a className={styles.link}>Two</a>',
  '      </div>',
  '    </header>',
  '  );',
  '};',
);

const TREE = {
  [file]: TOP_BAR,
  'src/app/components/TopBar/TopBar.module.css': '.root {\n}\n',
  'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
};

async function project(tree: Record<string, string> = TREE) {
  const root = await createProject(tree, { appFiles: 'app' });
  const { config } = await loadConfig(root);
  const resolve = async (target: string) => (await resolveTarget(root, config!, target)).element;
  const idAt = async (line: number) => ((await idCommand.run({ cwd: root, args: { target: `${file}:${line}` }, options: {} })).data as { id: string }).id;
  return { root, resolve, idAt };
}

describe('element ids by name', () => {
  it('gives a named element its name as id, the root "root", and the others their path', async () => {
    const { idAt } = await project();
    expect(await idAt(5)).toBe(`${ids}#root`);
    expect(await idAt(10)).toBe(`${ids}#signIn`);
    expect(await idAt(9)).toBe(`${ids}#end/button[2]`);
    // A name several elements share identifies none of them: their ids are paths from the nearest name.
    expect(await idAt(11)).toBe(`${ids}#end/a[1]`);
  });

  it('resolves names alone, names in paths, and positional paths', async () => {
    const { resolve } = await project();
    expect((await resolve(`${ids}#signIn`)).start.line).toBe(10);
    expect((await resolve(`${ids}#root/end/signIn`)).start.line).toBe(10);
    expect((await resolve(`${ids}#header/div[2]/button[3]`)).start.line).toBe(10);
    await expect(resolve(`${ids}#link`)).rejects.toThrow('2 elements of TopBar are named "link".');
  });

  it('keeps a name pointing at the same element when siblings are inserted before it', async () => {
    const { root, resolve } = await project();
    const result = await elementInsertCommand.run({
      cwd: root,
      args: { name: 'button' },
      options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into: `${ids}#end`, position: 'first', from: undefined, props: undefined, text: 'Help', name: 'help', direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
    });
    expect((result.data as { id: string }).id).toBe(`${ids}#help`);
    expect(result.summary).toBe(`Inserted <button> into ${file}: ${ids}#help.`);
    // The name still finds Sign In; the old position now points at another button.
    expect((await resolve(`${ids}#signIn`)).start.line).toBe(11);
    expect((await resolve(`${ids}#header/div[2]/button[3]`)).start.line).toBe(10);
  });

  it('starts a path from any element with a unique name', async () => {
    const { resolve, idAt } = await project();
    expect((await resolve(`${ids}#end/button[2]`)).start.line).toBe(9);
    expect((await resolve(`${ids}#end/a[2]`)).start.line).toBe(12);
    expect(await idAt(12)).toBe(`${ids}#end/a[2]`);
  });

  it('prefers a name over a tag in a path segment', async () => {
    const tree = { ...TREE, [file]: TOP_BAR.replace('<div className={styles.start} />', '<div className={styles.nav} />\n      <nav />') };
    const { resolve } = await project(tree);
    expect((await resolve(`${ids}#root/nav`)).tag).toBe('div');
  });
});
