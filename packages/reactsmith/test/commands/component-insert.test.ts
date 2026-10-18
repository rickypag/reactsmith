import { describe, expect, it } from 'vitest';
import { componentInsertCommand } from '../../src/commands/component/insert/command.js';
import type { InsertPosition } from '../../src/shared/components/insert.js';
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
  name?: string;
  feature?: string;
  dryRun?: boolean;
}

async function insert(into: string, options: Options = {}, hostText = SIDEBAR, extra: Record<string, string> = {}) {
  const root = await createProject({ ...USER_CARD, [host]: hostText, ...extra }, { appFiles: 'root' });
  const result = await componentInsertCommand.run({
    cwd: root,
    args: { name: options.name ?? 'Badge' },
    options: { feature: options.feature ?? 'docs', app: false, into, position: options.position, props: options.props, dryRun: options.dryRun ?? false },
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
    await componentInsertCommand.run({
      cwd: root,
      args: { name: 'Badge' },
      options: { feature: 'docs', app: false, into: `${view}:1`, position: undefined, props: undefined, dryRun: false },
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
    expect((await insert(`${hostId}#div/nav`, { name: 'UserCard', props: '{...user}' })).text).toContain('<UserCard {...user} />');
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
    expect(await code(`${hostId}#div/nav`, { name: 'Nope' })).toEqual(['component-missing']);

    const other = 'src/features/blog/views/BlogView/BlogView.tsx';
    expect(await code(`${other}:1`, {}, undefined, { [other]: 'export const BlogView: React.FC = () => <main />;\n' })).toEqual(['insert-out-of-scope']);

    const badge = `${components}/Badge/Badge.tsx`;
    expect(await code(`${badge}:1`)).toEqual(['insert-into-itself']);

    const taken = lines("import { Badge } from '@mui/material';", 'export const Sidebar: React.FC = () => <div></div>;');
    expect(await code(`${hostId}#div`, {}, taken)).toEqual(['insert-name-taken']);
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
      componentInsertCommand.run({ cwd: root, args: { name: 'TopBar' }, options: { feature: undefined, app: true, into, position: undefined, props: undefined, dryRun: false } });

    expect((await run(`${layout}:1`)).ok).toBe(true);
    expect(await read(root, layout)).toBe("import { TopBar } from '../../components/TopBar';\n\nexport const RootLayout: React.FC = () => <div><TopBar /></div>;\n");
    expect((await run(`${hostId}#div`)).issues?.map((issue) => issue.code)).toEqual(['insert-out-of-scope']);
  });

  it('writes nothing with --dry-run', async () => {
    const { result, text } = await insert(`${hostId}#div/nav`, { dryRun: true });
    expect(result.actions).toHaveLength(1);
    expect(text).toBe(SIDEBAR);
  });
});
