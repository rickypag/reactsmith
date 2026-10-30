import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { elementRemoveCommand } from '../../src/commands/element/remove/command.js';
import { idCommand } from '../../src/commands/id/command.js';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/components/Panel';
const file = `${dir}/Panel.tsx`;
const id = 'app/components/Panel/Panel.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const PANEL = lines(
  "import styles from './Panel.module.css';",
  '',
  'export interface PanelProps {',
  '  open: boolean;',
  '  soon?: boolean;',
  '  label?: string;',
  '  items: ItemProps[];',
  '}',
  '',
  'export const Panel: React.FC<PanelProps> = ({ open }) => {',
  '  return (',
  '    <section className={styles.root}>',
  '      <h2 className={styles.title}>Panel</h2>',
  '      {open && (',
  '        <nav className={styles.items}>',
  '          <a href="/">Home</a>',
  '        </nav>',
  '      )}',
  '    </section>',
  '  );',
  '};',
);

const ITEM = {
  'src/app/components/Item/Item.tsx': "export interface ItemProps {\n  label: string;\n}\n\nexport const Item: React.FC<ItemProps> = ({ label }) => <span>{label}</span>;\n",
  'src/app/components/Item/index.ts': "export { Item } from './Item';\nexport type { ItemProps } from './Item';\n",
};

async function project(text = PANEL) {
  return createProject(
    {
      ...ITEM,
      [file]: text.replace("import styles from './Panel.module.css';", "import styles from './Panel.module.css';\nimport type { ItemProps } from '../Item';"),
      [`${dir}/Panel.module.css`]: '.root {\n}\n\n.title {\n}\n\n.items {\n}\n',
      [`${dir}/index.ts`]: "export { Panel } from './Panel';\n",
    },
    { appFiles: 'app' },
  );
}

interface InsertOptions {
  into?: string;
  around?: string;
  through?: string;
  position?: 'inside' | 'first' | 'before' | 'after';
  text?: string;
  name?: string;
  props?: string;
  if?: string;
  fallback?: string;
  each?: string;
  as?: string;
  key?: string;
}

const insert = (root: string, tag: string, options: InsertOptions) =>
  elementInsertCommand.run({
    cwd: root,
    args: { name: tag },
    options: {
      into: options.into,
      around: options.around,
      through: options.through,
      position: options.position,
      from: undefined,
      props: options.props,
      text: options.text,
      name: options.name,
      if: options.if,
      fallback: options.fallback,
      direction: undefined,
      gap: undefined,
      align: undefined,
      justify: undefined,
      padding: undefined,
      each: options.each,
      as: options.as,
      key: options.key,
      dryRun: false,
    },
  });

const remove = (root: string, target: string, keepChildren = false) => elementRemoveCommand.run({ cwd: root, args: { target }, options: { keepChildren, dryRun: false } });
const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code) ?? [];
const issuesOf = async (root: string, code: string) => (await checkStructure(root)).issues.filter((issue) => issue.code === code);

describe('conditions: ids', () => {
  it('addresses a condition by its test, and keeps the names of what it shows', async () => {
    const root = await project();
    const at = async (line: number) => ((await idCommand.run({ cwd: root, args: { target: `${file}:${line}` }, options: {} })).data as { id: string }).id;
    expect(await at(16)).toBe(`${id}#items`);
    const result = await insert(root, 'a', { into: `${id}#root/{?open}/nav`, props: 'href="/docs"', text: 'Docs' });
    expect(codes(result)).toEqual([]);
    expect(await read(root, file)).toContain('          <a href="/">Home</a>\n          <a href="/docs">Docs</a>\n');
  });
});

describe('conditions: check', () => {
  it.each([
    ['{ready && open && <p>x</p>}', 'the test must be a name'],
    ['{items.length > 0 && <p>x</p>}', 'the test must be a name'],
    ['{open && <><p>a</p><p>b</p></>}', 'each branch must be one element, one list or null'],
    ["{open ? 'Hide' : <p>x</p>}", 'each branch must be one element, one list or null'],
    ['{open && (soon ? <p>a</p> : null)}', "a branch can't be another condition"],
    ['{label.trim() ?? <p>x</p>}', 'the value before ?? must be a name'],
    ['{open ? null : null}', ''],
  ])('reports %s', async (condition, reason) => {
    const text = PANEL.replace('      <h2 className={styles.title}>Panel</h2>', `      <h2 className={styles.title}>Panel</h2>\n      ${condition}`);
    const issues = await issuesOf(await project(text), 'condition-shape-invalid');
    if (condition === '{open ? null : null}') {
      expect(issues).toHaveLength(0);
      return;
    }
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain(reason);
  });

  it.each([
    '{!open && <p>x</p>}',
    '{open ? <p>a</p> : <span>b</span>}',
    '{open ? null : <p>b</p>}',
    '{label ?? <p>x</p>}',
    '{label || <p>x</p>}',
    '{open && items.map((item) => <Item key={item.label} {...item} />)}',
    "{open ? 'Hide' : 'Show'}",
  ])('accepts %s, and lists in conditions in their shape', async (condition) => {
    const text = PANEL.replace('({ open })', '({ open, label, items })').replace('      <h2 className={styles.title}>Panel</h2>', `      <h2 className={styles.title}>Panel</h2>\n      <div>${condition}</div>`);
    const root = await project(text.replace("import styles from './Panel.module.css';", "import styles from './Panel.module.css';\nimport { Item } from '../Item';"));
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code === 'condition-shape-invalid' || issue.code === 'list-shape-invalid');
    expect(issues).toEqual([]);
  });

  it('checks the list in a condition like any list', async () => {
    const text = PANEL.replace('      <h2 className={styles.title}>Panel</h2>', '      <h2 className={styles.title}>Panel</h2>\n      <div>{open && items.map((item) => <Item {...item} />)}</div>');
    const issues = await issuesOf(await project(text), 'list-shape-invalid');
    expect(issues.map((issue) => issue.message)).toEqual(['The list on line 15 is not in the list shape: the component needs a key, e.g. key={link.id}.']);
  });
});

describe('conditions: element insert', () => {
  it('inserts an element shown when a prop holds, destructuring the prop', async () => {
    const root = await project();
    expect(codes(await insert(root, 'span', { into: `${id}#root`, text: 'soon', name: 'badge', if: 'soon' }))).toEqual([]);
    const text = await read(root, file);
    expect(text).toContain('      {soon && <span className={styles.badge}>soon</span>}\n');
    expect(text).toContain('({ open, soon })');
    expect((await issuesOf(root, 'condition-shape-invalid')).length).toBe(0);
  });

  it('writes the opposite with "!", a fallback with ??, and a list under a condition', async () => {
    const root = await project();
    await insert(root, 'p', { into: `${id}#root`, text: 'Closed', if: '!open' });
    await insert(root, 'p', { into: `${id}#root`, text: 'No label', fallback: 'label' });
    await insert(root, 'Item', { into: `${id}#items`, each: 'items', as: 'item', key: 'item.label', props: '{...item}', if: 'open' });
    const text = await read(root, file);
    expect(text).toContain('{!open && <p>Closed</p>}');
    expect(text).toContain('{label ?? <p>No label</p>}');
    expect(text).toContain('{open && items.map((item) => <Item key={item.label} {...item} />)}');
  });

  it('refuses tests that are not names, and both options at once', async () => {
    const root = await project();
    expect(codes(await insert(root, 'p', { into: `${id}#root`, if: 'items.length > 0' }))).toEqual(['condition-test-invalid']);
    expect(codes(await insert(root, 'p', { into: `${id}#root`, fallback: '!label' }))).toEqual(['condition-test-invalid']);
    expect(codes(await insert(root, 'p', { into: `${id}#root`, if: 'open', fallback: 'label' }))).toEqual(['options-conflict']);
    expect(codes(await insert(root, 'p', { into: `${id}#root`, if: 'missing' }))).toEqual(['value-name-unknown']);
  });

  it('puts an element next to a branch outside the condition', async () => {
    const root = await project();
    expect(codes(await insert(root, 'p', { into: `${id}#items`, position: 'after', text: 'Always' }))).toEqual([]);
    expect(await read(root, file)).toContain('      )}\n      <p>Always</p>\n');
  });

  it('adds the other branch by inserting into the condition, and refuses a third one', async () => {
    const root = await project();
    expect(codes(await insert(root, 'p', { into: `${id}#root/{?open}`, text: 'Closed' }))).toEqual([]);
    const text = await read(root, file);
    expect(text).toContain(': <p>Closed</p>');
    expect(text).toMatch(/\{open \? \(?\s*<nav/);
    expect((await issuesOf(root, 'condition-shape-invalid')).length).toBe(0);
    expect(codes(await insert(root, 'p', { into: `${id}#root/{?open}`, text: 'Third' }))).toEqual(['condition-full']);
    expect(codes(await insert(root, 'p', { into: `${id}#root/{?open}`, text: 'Nested', if: 'soon' }))).toEqual(['condition-nested']);
  });
});

describe('conditions: wrapping', () => {
  it('puts an element or a list in a condition, and wraps a branch inside it', async () => {
    const root = await project();
    expect(codes(await insert(root, '{?soon}', { around: `${id}#title` }))).toEqual([]);
    expect(await read(root, file)).toContain('{soon && <h2 className={styles.title}>Panel</h2>}');
    expect(codes(await insert(root, 'div', { around: `${id}#items`, name: 'frame' }))).toEqual([]);
    expect(await read(root, file)).toMatch(/\{open && \(\s*<div className=\{styles\.frame\}>\s*<nav/);
  });

  it('refuses the root, nesting, several elements and options that do not apply', async () => {
    const root = await project();
    expect(codes(await insert(root, '{?soon}', { around: `${id}#root` }))).toEqual(['wrap-root']);
    expect(codes(await insert(root, '{?soon}', { around: `${id}#items` }))).toEqual(['condition-nested']);
    expect(codes(await insert(root, '{?soon}', { around: `${id}#root/{?open}` }))).toEqual(['condition-wrap-invalid']);
    expect(codes(await insert(root, '{?soon}', { around: `${id}#title`, through: `${id}#root/{?open}` }))).toEqual(['options-conflict']);
    expect(codes(await insert(root, '{?soon}', { into: `${id}#root` }))).toEqual(['options-conflict']);
    expect(codes(await insert(root, '{?a b}', { around: `${id}#title` }))).toEqual(['condition-test-invalid']);
  });
});

describe('conditions: element remove', () => {
  it('removes a condition with what it shows, or keeps it with --keep-children', async () => {
    const gone = await project();
    expect(codes(await remove(gone, `${id}#root/{?open}`))).toEqual([]);
    const text = await read(gone, file);
    expect(text).not.toContain('open &&');
    expect(await read(gone, `${dir}/Panel.module.css`)).not.toContain('.items');

    const kept = await project();
    expect(codes(await remove(kept, `${id}#root/{?open}`, true))).toEqual([]);
    expect(await read(kept, file)).toContain('      <nav className={styles.items}>\n          <a href="/">Home</a>\n        </nav>\n');
  });

  it('removes a branch: the other stays, or the condition goes with the only one', async () => {
    const root = await project();
    await insert(root, 'p', { into: `${id}#root/{?open}`, text: 'Closed', name: 'closed' });
    expect(codes(await remove(root, `${id}#items`))).toEqual([]);
    expect(await read(root, file)).toContain('{!open && <p className={styles.closed}>Closed</p>}');
    expect(codes(await remove(root, `${id}#closed`))).toEqual([]);
    expect(await read(root, file)).not.toMatch(/open &&|Closed/);
  });

  it('refuses what would lose a value or a condition', async () => {
    const root = await project();
    await insert(root, 'p', { into: `${id}#root`, text: 'No label', fallback: 'label', name: 'empty' });
    expect(codes(await remove(root, `${id}#empty`))).toEqual(['remove-fallback-branch']);
    expect(codes(await remove(root, `${id}#root/{?label}`, true))).toEqual(['remove-fallback-keep-children']);
    expect(codes(await remove(root, `${id}#items`, true))).toEqual(['remove-branch-keep-children']);
    await insert(root, 'p', { into: `${id}#root/{?open}`, text: 'Closed' });
    expect(codes(await remove(root, `${id}#root/{?open}`, true))).toEqual(['remove-condition-two-branches']);
  });
});

describe('conditions: other commands', () => {
  it('styles and updates the elements a condition shows', async () => {
    const root = await project();
    const style = await styleUpdateCommand.run({
      cwd: root,
      args: { target: `${id}#items` },
      options: { name: undefined, state: undefined, when: undefined, css: 'gap: 4px', cssFile: undefined, object: undefined, objectFile: undefined, class: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, dryRun: false },
    });
    expect(codes(style)).toEqual([]);
    expect(await read(root, `${dir}/Panel.module.css`)).toContain('.items {\n  gap: 4px;\n}');
  });
});
