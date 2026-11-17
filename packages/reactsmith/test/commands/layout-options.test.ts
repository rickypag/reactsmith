import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const file = `${dir}/TopBar.tsx`;
const id = 'app/components/TopBar/TopBar.tsx';

const TREE = {
  [file]: "import styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => {\n  return (\n    <header className={styles.root}>\n      <span className={styles.brand}>Docs</span>\n    </header>\n  );\n};\n",
  [`${dir}/TopBar.module.css`]: '.root {\n  display: flex;\n}\n\n.brand {\n}\n',
  [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
  'src/app/components/Card/Card.tsx': "export interface CardProps {\n  children?: React.ReactNode;\n  className?: string;\n}\n\nexport const Card: React.FC<CardProps> = ({ children }) => <div>{children}</div>;\n",
  'src/app/components/Card/index.ts': "export { Card } from './Card';\n",
};

const create = (root: string, name: string, rootTag: string) =>
  componentCreateCommand.run({
    cwd: root,
    args: { name },
    options: { feature: undefined, app: true, type: undefined, interface: undefined, rootProps: undefined, from: undefined, direction: 'row', gap: '2', align: 'center', justify: undefined, padding: undefined, root: rootTag, text: undefined, jsx: undefined, replace: false, dryRun: false },
  });

const insert = (root: string, tag: string, name: string) =>
  elementInsertCommand.run({
    cwd: root,
    args: { name: tag },
    options: { into: `${id}#root`, around: undefined, through: undefined, if: undefined, fallback: undefined, position: undefined, from: undefined, props: undefined, text: undefined, message: undefined, name, direction: 'row', gap: '1', align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });

const style = (root: string, target: string) =>
  styleUpdateCommand.run({
    cwd: root,
    args: { target },
    options: { name: undefined, state: undefined, when: undefined, css: undefined, cssFile: undefined, object: undefined, objectFile: undefined, class: undefined, direction: 'row', gap: undefined, align: 'center', justify: undefined, padding: undefined, at: undefined, dryRun: false },
  });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code) ?? [];

describe('layout options: the same rule in every command', () => {
  it('lays out buttons and links as inline-flex, in component create, element insert and style update', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await create(root, 'SearchButton', 'button'))).toEqual([]);
    expect(await read(root, 'src/app/components/SearchButton/SearchButton.module.css')).toBe('.root {\n  display: inline-flex;\n  flex-direction: row;\n  gap: var(--space-2);\n  align-items: center;\n}\n');

    expect(codes(await insert(root, 'a', 'link'))).toEqual([]);
    expect(await read(root, `${dir}/TopBar.module.css`)).toContain('.link {\n  display: inline-flex;\n  flex-direction: row;\n  gap: var(--space-1);\n}');

    expect(codes(await insert(root, 'button', 'toggle'))).toEqual([]);
    expect(codes(await style(root, `${id}#toggle`))).toEqual([]);
    expect(await read(root, `${dir}/TopBar.module.css`)).toMatch(/\.toggle \{\n {2}display: inline-flex;\n {2}flex-direction: row;\n {2}gap: var\(--space-1\);\n {2}align-items: center;\n\}/);
  });

  it('accepts components that take children, and keeps flex for layout elements', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await create(root, 'Panel', 'Card'))).toEqual([]);
    expect(await read(root, 'src/app/components/Panel/Panel.module.css')).toContain('display: flex;');
    expect(codes(await insert(root, 'nav', 'links'))).toEqual([]);
    expect(await read(root, `${dir}/TopBar.module.css`)).toContain('.links {\n  display: flex;');
  });

  it('refuses elements that hold no elements, with the same code everywhere', async () => {
    const root = await createProject(TREE, { appFiles: 'app' });
    expect(codes(await create(root, 'Logo', 'img'))).toEqual(['layout-not-allowed']);
    expect(codes(await insert(root, 'span', 'label'))).toEqual(['layout-not-allowed']);
    const refused = await style(root, `${id}#brand`);
    expect(codes(refused)).toEqual(['layout-not-allowed']);
    expect(refused.issues?.[0]?.message).toBe('<span> holds no elements, so it takes no layout options.');
  });
});
