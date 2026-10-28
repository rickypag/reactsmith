import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import type { InsertPosition } from '../../src/shared/elements/position.js';
import { createProject, read } from '../helpers.js';

const components = 'src/features/docs/components';
const host = `${components}/Sidebar/Sidebar.tsx`;
const hostId = 'features/docs/components/Sidebar/Sidebar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const USER_CARD = {
  [`${components}/UserCard/UserCard.tsx`]: lines(
    'export interface UserCardProps {',
    '  title: string;',
    '  subtitle?: string;',
    '}',
    '',
    'export const UserCard: React.FC<UserCardProps> = () => <div>UserCard</div>;',
  ),
  [`${components}/UserCard/index.ts`]: "export { UserCard } from './UserCard';\n",
  [`${components}/Badge/Badge.tsx`]: 'export const Badge: React.FC = () => <span>Badge</span>;\n',
  [`${components}/Badge/index.ts`]: "export { Badge } from './Badge';\n",
};

const SIDEBAR = lines(
  "import { Badge } from '../Badge';",
  '',
  'export const Sidebar: React.FC = () => {',
  '  return (',
  '    <div>',
  '      <nav>',
  '        <a href="/">Home</a>',
  '      </nav>',
  '      <footer />',
  '      <p>Text</p>',
  '      <ul><li>One</li></ul>',
  '    </div>',
  '  );',
  '};',
);

interface Options {
  position?: InsertPosition;
  props?: string;
  each?: string;
  as?: string;
  key?: string;
  name?: string;
  from?: string;
  dryRun?: boolean;
}

async function insert(into: string, options: Options = {}, hostText = SIDEBAR, extra: Record<string, string> = {}) {
  const root = await createProject({ ...USER_CARD, [host]: hostText, ...extra }, { appFiles: 'root' });
  const result = await elementInsertCommand.run({
    cwd: root,
    args: { name: options.name ?? 'Badge' },
    options: { around: undefined, through: undefined, into, position: options.position, from: options.from, props: options.props, text: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: options.each, as: options.as, key: options.key, dryRun: options.dryRun ?? false },
  });
  return { result, text: await read(root, host), root };
}

/** The lines of the host's JSX after inserting, without the shared start and end. */
async function jsxAfter(into: string, options: Options = {}) {
  const { result, text } = await insert(into, options);
  expect(result.issues).toEqual([]);
  return text.split('\n').slice(5, -4);
}

describe('component insert: positions', () => {
  it('inserts as the last child by default, matching the children indentation', async () => {
    expect(await jsxAfter(`${hostId}#div/nav`)).toEqual([
      '      <nav>',
      '        <a href="/">Home</a>',
      '        <Badge />',
      '      </nav>',
      '      <footer />',
      '      <p>Text</p>',
      '      <ul><li>One</li></ul>',
    ]);
  });

  it('inserts as the first child', async () => {
    expect((await jsxAfter(`${hostId}#div/nav`, { position: 'first' })).slice(0, 3)).toEqual([
      '      <nav>',
      '        <Badge />',
      '        <a href="/">Home</a>',
    ]);
  });

  it('inserts before and after an element, on its own line', async () => {
    expect((await jsxAfter(`${hostId}#div/p`, { position: 'before' })).slice(3, 6)).toEqual(['      <footer />', '      <Badge />', '      <p>Text</p>']);
    expect((await jsxAfter(`${hostId}#div/p`, { position: 'after' })).slice(4, 7)).toEqual(['      <p>Text</p>', '      <Badge />', '      <ul><li>One</li></ul>']);
  });

  it('opens a self-closing layout element', async () => {
    expect((await jsxAfter(`${hostId}#div/footer`)).slice(3, 6)).toEqual(['      <footer>', '        <Badge />', '      </footer>']);
  });

  it('stays on one line when the element is on one line', async () => {
    const after = await jsxAfter(`${hostId}#div/ul`);
    expect(after[after.length - 1]).toBe('      <ul><li>One</li><Badge /></ul>');
    const before = await jsxAfter(`${hostId}#div/ul/li`, { position: 'before' });
    expect(before[before.length - 1]).toBe('      <ul><Badge /><li>One</li></ul>');
  });

  it('accepts a file location as the target', async () => {
    expect((await jsxAfter(`${host}:6`))[2]).toBe('        <Badge />');
  });
});

describe('component insert: imports and props', () => {
  it('reuses an existing import, and adds a missing one after the others', async () => {
    const reused = await insert(`${hostId}#div/nav`);
    expect(reused.result.actions).toEqual([{ type: 'update', path: host, message: 'inserted <Badge> into div/nav' }]);
    expect(reused.text.startsWith("import { Badge } from '../Badge';\n\nexport")).toBe(true);

    const added = await insert(`${hostId}#div/nav`, { name: 'UserCard', props: 'title="Docs"' });
    expect(added.text.startsWith("import { Badge } from '../Badge';\nimport { UserCard } from '../UserCard';\n\nexport")).toBe(true);
    expect(added.text).toContain('        <UserCard title="Docs" />\n');
  });

  it('adds the first import of a file with a blank line, with a path from a view', async () => {
    const view = 'src/features/docs/views/HomeView/HomeView.tsx';
    const root = await createProject({ ...USER_CARD, [view]: 'export const HomeView: React.FC = () => <main></main>;\n' }, { appFiles: 'root' });
    await elementInsertCommand.run({
      cwd: root,
      args: { name: 'Badge' },
      options: { around: undefined, through: undefined, into: `${view}:1`, position: undefined, from: undefined, props: undefined, text: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
    });
    expect(await read(root, view)).toBe(
      "import { Badge } from '../../components/Badge';\n\nexport const HomeView: React.FC = () => <main><Badge /></main>;\n",
    );
  });

  it.each([
    [undefined, 'props-required', '"UserCard" needs "title", or the code would not compile.'],
    ['title="a" color="red"', 'props-unknown', '"UserCard" has no prop "color".'],
    ['title=', 'props-invalid', 'The props "title=" are not valid JSX attributes.'],
  ])('checks the props %j', async (props, code, message) => {
    const { result } = await insert(`${hostId}#div/nav`, { name: 'UserCard', props });
    expect(result.issues?.map((issue) => `${issue.code}: ${issue.message}`)).toEqual([`${code}: ${message}`]);
  });

  it('accepts spreads without checking required props', async () => {
    const host = SIDEBAR.replace('  return (', "  const user = { title: 'Docs' };\n  return (");
    expect((await insert(`${hostId}#div/nav`, { name: 'UserCard', props: '{...user}' }, host)).text).toContain('<UserCard {...user} />');
  });

  it('takes variables of the file as values, destructuring the props they use', async () => {
    const host = SIDEBAR.replace("import { Badge } from '../Badge';", "import { Badge } from '../Badge';\nimport { SITE } from '@/config';").replace(
      'export const Sidebar: React.FC = () => {',
      'export interface SidebarProps {\n  heading: string;\n}\n\nexport const Sidebar: React.FC<SidebarProps> = () => {',
    );
    const { result, text } = await insert(`${hostId}#div/nav`, { name: 'UserCard', props: "title={heading} subtitle={SITE.name}" }, host);
    expect(result.issues).toEqual([]);
    expect(text).toContain('export const Sidebar: React.FC<SidebarProps> = ({ heading }) => {');
    expect(text).toContain('<UserCard title={heading} subtitle={SITE.name} />');
  });

  it('accepts literals, also in arrays and objects', async () => {
    const { result } = await insert(`${hostId}#div/nav`, { name: 'UserCard', props: "title={'Docs'} subtitle={[1, -2, `x`, { on: true, off: null }]}" });
    expect(result.issues).toEqual([]);
  });

  it.each([
    ['title={label}', 'value-name-unknown', '"label" is not a prop of Sidebar, a constant, nor an import of its file.'],
    ['title={format(x)}', 'value-expression-not-allowed', '"title={format(x)}" computes its value: only variables (names and property paths) and literals are allowed.'],
    ['title={a ? b : c}', 'value-expression-not-allowed', '"title={a ? b : c}" computes its value: only variables (names and property paths) and literals are allowed.'],
  ])('refuses the values of %j', async (props, code, message) => {
    const { result } = await insert(`${hostId}#div/nav`, { name: 'UserCard', props });
    expect(result.issues?.map((issue) => `${issue.code}: ${issue.message}`)).toEqual([`${code}: ${message}`]);
  });
});

describe('component insert: refusals', () => {
  const code = async (into: string, options: Options = {}, hostText?: string, extra?: Record<string, string>) =>
    (await insert(into, options, hostText, extra)).result.issues?.map((issue) => issue.code);

  it('refuses targets that are not layout elements', async () => {
    expect(await code(`${hostId}#div/p`)).toEqual(['insert-target-not-layout']);
    expect(await code(`${hostId}#div`, { position: 'after' })).toEqual(['insert-target-not-layout']);
  });

  it('refuses missing components, other features, the component itself and taken names', async () => {
    expect(await code(`${hostId}#div/nav`, { name: 'Nope' })).toEqual(['element-source-missing']);

    const other = 'src/features/blog/views/BlogView/BlogView.tsx';
    expect(await code(`${other}:1`, {}, undefined, { [other]: 'export const BlogView: React.FC = () => <main />;\n' })).toEqual(['element-source-missing']);

    const badge = `${components}/Badge/Badge.tsx`;
    expect(await code(`${badge}:1`)).toEqual(['insert-into-itself']);

    const taken = lines("import { Badge } from '@mui/material';", 'export const Sidebar: React.FC = () => <div></div>;');
    expect(await code(`${hostId}#div`, { from: 'docs' }, taken)).toEqual(['insert-name-taken']);
  });

  it('inserts app components into app files only', async () => {
    const layout = 'src/app/layouts/RootLayout/RootLayout.tsx';
    const root = await createProject(
      {
        ...USER_CARD,
        'src/app/components/TopBar/TopBar.tsx': 'export const TopBar: React.FC = () => <header />;\n',
        'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
        [layout]: 'export const RootLayout: React.FC = () => <div></div>;\n',
        [host]: SIDEBAR,
      },
      { appFiles: 'root' },
    );
    const run = (into: string) =>
      elementInsertCommand.run({ cwd: root, args: { name: 'TopBar' }, options: { around: undefined, through: undefined, into, position: undefined, from: undefined, props: undefined, text: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false } });

    expect((await run(`${layout}:1`)).ok).toBe(true);
    expect(await read(root, layout)).toBe("import { TopBar } from '../../components/TopBar';\n\nexport const RootLayout: React.FC = () => <div><TopBar /></div>;\n");
    expect((await run(`${hostId}#div`)).issues?.map((issue) => issue.code)).toEqual(['element-source-missing']);
  });

  it('writes nothing with --dry-run', async () => {
    const { result, text } = await insert(`${hostId}#div/nav`, { dryRun: true });
    expect(result.actions).toHaveLength(1);
    expect(text).toBe(SIDEBAR);
  });
});
