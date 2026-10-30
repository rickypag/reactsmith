import { describe, expect, it } from 'vitest';
import { elementMoveCommand } from '../../src/commands/element/move/command.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/components/Panel';
const file = `${dir}/Panel.tsx`;
const id = 'app/components/Panel/Panel.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const PANEL = lines(
  "import { useState } from 'react';",
  "import styles from './Panel.module.css';",
  '',
  'export interface PanelProps {',
  '  soon?: boolean;',
  '}',
  '',
  'export const Panel: React.FC<PanelProps> = ({ soon }) => {',
  '  const [open, setOpen] = useState(false);',
  '  return (',
  '    <section className={styles.root}>',
  '      <h2 className={styles.title}>Panel</h2>',
  '      <p className={styles.lead}>Lead</p>',
  '      <nav className={styles.links}>',
  '        <a href="/">Home</a>',
  '        <button className={styles.toggle} onClick={() => setOpen(!open)}>Toggle</button>',
  '      </nav>',
  '      <div className={styles.side} />',
  '      {soon && <span className={styles.badge}>soon</span>}',
  '    </section>',
  '  );',
  '};',
);
const CSS = '.root {\n}\n\n.title {\n}\n\n.lead {\n}\n\n.links {\n}\n\n.toggle {\n}\n\n.side {\n}\n\n.badge {\n}\n';

async function project() {
  return createProject({ [file]: PANEL, [`${dir}/Panel.module.css`]: CSS, [`${dir}/index.ts`]: "export { Panel } from './Panel';\n", 'src/app/components/Other/Other.tsx': "import styles from './Other.module.css';\n\nexport const Other: React.FC = () => <div className={styles.root} />;\n" }, { appFiles: 'app' });
}

const move = (root: string, target: string, into: string, position?: 'inside' | 'first' | 'before' | 'after', through?: string) =>
  elementMoveCommand.run({ cwd: root, args: { target: `${id}#${target}` }, options: { into: into.includes('.tsx') ? into : `${id}#${into}`, position, through: through && `${id}#${through}`, dryRun: false } });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code) ?? [];
const body = (text: string) => text.slice(text.indexOf('    <section'), text.indexOf('    </section>') + 14);

describe('element move', () => {
  it('reorders siblings, and keeps names, styles and logic as they are', async () => {
    const root = await project();
    const result = await move(root, 'lead', 'title', 'before');
    expect(codes(result)).toEqual([]);
    expect(result.data).toMatchObject({ id: `${id}#lead` });
    expect(body(await read(root, file))).toBe(
      [
        '    <section className={styles.root}>',
        '      <p className={styles.lead}>Lead</p>',
        '      <h2 className={styles.title}>Panel</h2>',
        '      <nav className={styles.links}>',
        '        <a href="/">Home</a>',
        '        <button className={styles.toggle} onClick={() => setOpen(!open)}>Toggle</button>',
        '      </nav>',
        '      <div className={styles.side} />',
        '      {soon && <span className={styles.badge}>soon</span>}',
        '    </section>',
      ].join('\n'),
    );
    expect(await read(root, `${dir}/Panel.module.css`)).toBe(CSS);
  });

  it('moves an element with its children into another one, indenting them for their new place', async () => {
    const root = await project();
    expect(codes(await move(root, 'links', 'side', 'inside'))).toEqual([]);
    expect(body(await read(root, file))).toBe(
      [
        '    <section className={styles.root}>',
        '      <h2 className={styles.title}>Panel</h2>',
        '      <p className={styles.lead}>Lead</p>',
        '      <div className={styles.side}>',
        '        <nav className={styles.links}>',
        '          <a href="/">Home</a>',
        '          <button className={styles.toggle} onClick={() => setOpen(!open)}>Toggle</button>',
        '        </nav>',
        '      </div>',
        '      {soon && <span className={styles.badge}>soon</span>}',
        '    </section>',
      ].join('\n'),
    );
    // And out again, at the start of the root.
    expect(codes(await move(root, 'toggle', 'root', 'first'))).toEqual([]);
    expect(body(await read(root, file))).toContain('    <section className={styles.root}>\n      <button className={styles.toggle} onClick={() => setOpen(!open)}>Toggle</button>\n      <h2');
  });

  it('moves a run of siblings together with --through, and a condition as a whole', async () => {
    const root = await project();
    expect(codes(await move(root, 'title', 'side', 'after', 'lead'))).toEqual([]);
    expect(body(await read(root, file))).toContain('      <div className={styles.side} />\n      <h2 className={styles.title}>Panel</h2>\n      <p className={styles.lead}>Lead</p>\n      {soon');
    expect(codes(await move(root, 'root/{?soon}', 'links', 'first'))).toEqual([]);
    expect(body(await read(root, file))).toContain('      <nav className={styles.links}>\n        {soon && <span className={styles.badge}>soon</span>}\n        <a href="/">Home</a>');
  });

  it('refuses what would break the code or change nothing', async () => {
    const root = await project();
    expect(codes(await move(root, 'root', 'links'))).toEqual(['move-root']);
    expect(codes(await move(root, 'badge', 'links'))).toEqual(['move-branch']);
    expect(codes(await move(root, 'title', 'app/components/Other/Other.tsx#root'))).toEqual(['move-other-file']);
    expect(codes(await move(root, 'links', 'toggle', 'after'))).toEqual(['move-into-itself']);
    expect(codes(await move(root, 'links', 'links', 'before'))).toEqual(['move-into-itself']);
    expect(codes(await move(root, 'title', 'lead'))).toEqual(['insert-target-not-layout']);
    expect(codes(await move(root, 'title', 'root/{?soon}'))).toEqual(['move-into-condition']);
    expect(codes(await move(root, 'lead', 'title', 'after'))).toEqual(['move-nothing']);
    expect(codes(await move(root, 'title', 'links', 'inside', 'toggle'))).toEqual(['move-not-siblings']);
    expect(await read(root, file)).toBe(PANEL);
  });
});
