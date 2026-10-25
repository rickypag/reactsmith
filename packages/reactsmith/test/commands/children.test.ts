import { describe, expect, it } from 'vitest';
import { componentCreateCommand } from '../../src/commands/component/create/command.js';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const lines = (...text: string[]) => `${text.join('\n')}\n`;
const view = 'src/features/docs/views/HomeView/HomeView.tsx';

const create = (root: string, name: string, options: { interface?: string; root?: string; text?: string }) =>
  componentCreateCommand.run({
    cwd: root,
    args: { name },
    options: { feature: undefined, app: false, type: 'cards', interface: options.interface, props: undefined, from: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, root: options.root, text: options.text, dryRun: false },
  });

const insert = (root: string, name: string, into: string, text?: string) =>
  elementInsertCommand.run({
    cwd: root,
    args: { name },
    options: { into, position: undefined, from: undefined, props: undefined, text, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

const HOME = (card: string) => ({
  'src/features/docs/index.ts': '',
  [view]: lines("import { Card } from '@/components/cards';", '', 'export const HomeView: React.FC = () => {', '  return (', '    <main>', `      ${card}`, '    </main>', '  );', '};'),
  'src/features/docs/views/HomeView/index.ts': "export { HomeView as Component } from './HomeView';\n",
});

describe('components with children', () => {
  it('renders children in the root when the props declare them', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    expect((await create(root, 'Card', { interface: 'children: React.ReactNode' })).issues).toEqual([]);
    expect(await read(root, 'src/components/cards/Card/Card.tsx')).toBe(
      lines(
        "import styles from './Card.module.css';",
        '',
        'export interface CardProps {',
        '  children?: React.ReactNode;',
        '}',
        '',
        'export const Card: React.FC<CardProps> = ({ children }) => {',
        '  return <div className={styles.root}>{children}</div>;',
        '};',
      ),
    );
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity !== 'warning' || issue.code === 'children-not-rendered')).toEqual([]);
  });

  it('refuses children with --text, or on a root that holds no elements', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    expect(codes(await create(root, 'Card', { interface: 'children: React.ReactNode', root: 'button', text: 'Hi' }))).toEqual(['options-conflict']);
    expect(codes(await create(root, 'Card', { interface: 'children: React.ReactNode', root: 'img' }))).toEqual(['root-children-not-allowed']);
  });

  it('takes elements where it is used, like a layout element, but not text directly', async () => {
    const root = await createProject(HOME('<Card />'), { appFiles: 'app' });
    await create(root, 'Card', { interface: 'children: React.ReactNode' });
    await create(root, 'Badge', {});
    const target = 'features/docs/views/HomeView/HomeView.tsx#main/Card';
    expect((await insert(root, 'h2', target, 'Queries')).issues).toEqual([]);
    expect(await read(root, view)).toContain('      <Card>\n        <h2>Queries</h2>\n      </Card>');
    expect(codes(await insert(root, 'Badge', 'components/cards/Card/Card.tsx#div'))).toEqual([]);
    // An empty card is valid: children are optional, so it can be inserted first and filled after.
    expect((await insert(root, 'Card', 'features/docs/views/HomeView/HomeView.tsx#main')).issues).toEqual([]);
  });

  it('refuses elements in a component without children', async () => {
    const root = await createProject(
      {
        ...HOME('<Card />'),
        'src/components/cards/Card/Card.tsx': 'export const Card: React.FC = () => <div />;\n',
        'src/components/cards/Card/index.ts': "export { Card } from './Card';\n",
        'src/components/cards/index.ts': "export { Card } from './Card';\n",
      },
      { appFiles: 'app' },
    );
    expect(codes(await insert(root, 'h2', 'features/docs/views/HomeView/HomeView.tsx#main/Card', 'Queries'))).toEqual(['insert-target-not-layout']);
  });
});

describe('check: children', () => {
  const CARD = (body: string) => ({
    'src/components/cards/Card/Card.tsx': lines('export interface CardProps {', '  children?: React.ReactNode;', '}', '', `export const Card: React.FC<CardProps> = ({ children }) => ${body};`),
    'src/components/cards/Card/index.ts': "export { Card } from './Card';\n",
    'src/components/cards/index.ts': "export { Card } from './Card';\n",
  });
  const codesOf = async (tree: Record<string, string>) =>
    (await checkStructure(await createProject(tree, { appFiles: 'app' }))).issues.map((issue) => issue.code).filter((code) => /children|text-outside/.test(code));

  it('warns when children are declared but never rendered', async () => {
    expect(await codesOf(CARD('<div>{children}</div>'))).toEqual([]);
    expect(await codesOf(CARD('<div />'))).toEqual(['children-not-rendered']);
  });

  it('keeps text out of components, even those with children', async () => {
    expect(await codesOf({ ...CARD('<div>{children}</div>'), ...HOME('<Card>Hello</Card>') })).toEqual(['text-outside-text-element']);
  });
});
