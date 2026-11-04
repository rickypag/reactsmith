import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { elementRemoveCommand } from '../../src/commands/element/remove/command.js';
import { idCommand } from '../../src/commands/id/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read, issuesOfUsedCode } from '../helpers.js';

const components = 'src/app/components';
const file = `${components}/TopBar/TopBar.tsx`;
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const NAV_LINK = {
  [`${components}/NavLink/NavLink.tsx`]: lines(
    "import styles from './NavLink.module.css';",
    '',
    'export interface NavLinkProps {',
    '  label: string;',
    '  href: string;',
    '}',
    '',
    'export const NavLink: React.FC<NavLinkProps> = ({ label, href }) => {',
    '  return <a className={styles.root} href={href}>{label}</a>;',
    '};',
  ),
  [`${components}/NavLink/NavLink.module.css`]: '.root {\n}\n',
  [`${components}/NavLink/index.ts`]: "export { NavLink } from './NavLink';\nexport type { NavLinkProps } from './NavLink';\n",
};

const TOP_BAR = lines(
  "import styles from './TopBar.module.css';",
  '',
  'export interface TopBarProps {',
  '  links: { label: string; href: string }[];',
  '}',
  '',
  'export const TopBar: React.FC<TopBarProps> = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <nav />',
  '    </header>',
  '  );',
  '};',
);

const TREE = {
  ...NAV_LINK,
  [file]: TOP_BAR,
  [`${components}/TopBar/TopBar.module.css`]: '.root {\n}\n',
  [`${components}/TopBar/index.ts`]: "export { TopBar } from './TopBar';\nexport type { TopBarProps } from './TopBar';\n",
};

interface ListOptions {
  into?: string;
  position?: 'inside' | 'first' | 'before' | 'after';
  each?: string;
  as?: string;
  key?: string;
  props?: string;
}

async function insertList(options: ListOptions = {}, text = TOP_BAR) {
  const root = await createProject({ ...TREE, [file]: text }, { appFiles: 'app' });
  const result = await elementInsertCommand.run({
    cwd: root,
    args: { name: 'NavLink' },
    options: {
      around: undefined, through: undefined, if: undefined, fallback: undefined, into: options.into ?? `${id}#header/nav`,
      position: options.position,
      from: undefined,
      text: undefined,
      name: undefined,
      direction: undefined,
      gap: undefined,
      align: undefined,
      justify: undefined,
      padding: undefined,
      props: 'props' in options ? options.props : 'label={link.label} href={link.href}',
      each: 'each' in options ? options.each : 'links',
      as: 'as' in options ? options.as : 'link',
      key: 'key' in options ? options.key : 'link.href',
      dryRun: false,
    },
  });
  return { root, result, text: await read(root, file) };
}

/** The TopBar with a list of NavLink in its nav. */
const WITH_LIST = lines(
  "import styles from './TopBar.module.css';",
  "import { NavLink } from '../NavLink';",
  '',
  'export interface TopBarProps {',
  '  links: { label: string; href: string }[];',
  '}',
  '',
  'export const TopBar: React.FC<TopBarProps> = ({ links }) => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <nav>',
  '        {links.map((link) => <NavLink key={link.href} label={link.label} href={link.href} />)}',
  '      </nav>',
  '    </header>',
  '  );',
  '};',
);

describe('element insert --each', () => {
  it('repeats the component over a list, destructuring the list prop, and passes check', async () => {
    const { root, result, text } = await insertList();
    expect(result.ok).toBe(true);
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'inserted a list of <NavLink> over links into #root/nav and its import from "../NavLink"' }]);
    expect(text).toBe(WITH_LIST);
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it('passes the whole item with a spread', async () => {
    const { text } = await insertList({ props: '{...link}' });
    expect(text).toContain('{links.map((link) => <NavLink key={link.href} {...link} />)}');
  });

  it('gives the list an id, "{links}", usable as a position and by "id"', async () => {
    const root = await createProject({ ...TREE, [file]: WITH_LIST }, { appFiles: 'app' });
    const located = await idCommand.run({ cwd: root, args: { target: `${file}:12` }, options: {} });
    expect(located.data).toMatchObject({ id: `${id}#root/nav/{links}` });

    const before = await insertList({ into: `${id}#header/nav/{links}`, position: 'before', each: 'links', as: 'item', key: 'item.href', props: '{...item}' }, WITH_LIST);
    expect(before.result.issues).toEqual([]);
    expect(before.text).toContain('        {links.map((item) => <NavLink key={item.href} {...item} />)}\n        {links.map((link) =>');
  });

  it.each([
    [{ as: undefined, key: undefined }, 'list-options-incomplete', 'A list needs --each, --as and --key: --as and --key are missing.'],
    [{ each: 'links.filter(x)' }, 'list-each-invalid', '"links.filter(x)" is not a variable.'],
    [{ each: 'pages' }, 'value-name-unknown', '"pages" is not a prop of TopBar, a constant, nor an import of its file.'],
    [{ as: 'links' }, 'list-as-taken', '"links" is already a name in TopBar.'],
    [{ key: 'index' }, 'list-key-invalid', 'The key "index" is not a value of the item "link".'],
    [{ props: 'label={item.label} href={link.href}' }, 'value-name-unknown', '"item" is not a prop of TopBar, a constant, nor an import of its file.'],
  ])('refuses %j', async (options, code, message) => {
    const { result, text } = await insertList(options as ListOptions);
    expect(result.issues?.map((issue) => `${issue.code}: ${issue.message}`)).toEqual([`${code}: ${message}`]);
    expect(text).toBe(TOP_BAR);
  });

  it.each([`${id}#header/nav/{links}`, `${id}#header/nav/{links}/NavLink`])('refuses content in the items of a list (%s), pointing to the item component', async (into) => {
    const { result, text } = await insertList({ into, each: 'links', as: 'item', key: 'item.href', props: '{...item}' }, WITH_LIST);
    expect(result.issues?.map((issue) => issue.code)).toEqual(['list-item-not-target']);
    expect(result.issues?.[0]?.message).toContain('is a list of <NavLink>');
    expect(result.issues?.[0]?.hint).toContain('Put the content inside NavLink');
    expect(text).toBe(WITH_LIST);
  });
});

describe('removing lists', () => {
  it('removes the whole list, and its import', async () => {
    const root = await createProject({ ...TREE, [file]: WITH_LIST }, { appFiles: 'app' });
    const result = await elementRemoveCommand.run({ cwd: root, args: { target: `${id}#header/nav/{links}` }, options: { keepChildren: false, dryRun: false } });
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'removed the list {links} of <NavLink> from #root/nav and the import of NavLink' }]);
    const text = await read(root, file);
    expect(text).not.toContain('NavLink');
    expect(text).toContain('      <nav>\n      </nav>');
  });

  it('drops the import when removing the element holding a list', async () => {
    const root = await createProject({ ...TREE, [file]: WITH_LIST }, { appFiles: 'app' });
    await elementRemoveCommand.run({ cwd: root, args: { target: `${id}#header/nav` }, options: { keepChildren: false, dryRun: false } });
    expect(await read(root, file)).not.toContain('NavLink');
  });
});

describe('check: list shape', () => {
  it.each([
    ['{links.filter((l) => l.on).map((link) => <NavLink key={link.href} {...link} />)}', 'the list must be a variable'],
    ['{links.map((link, i) => <NavLink key={i} {...link} />)}', 'the arrow function must take just the item'],
    ['{links.map((link) => { return <NavLink key={link.href} {...link} />; })}', 'without a block or other logic'],
    ['{links.map((link) => <li key={link.href}>{link.label}</li>)}', 'it must repeat exactly one component'],
    ['{links.map((link) => <NavLink {...link} />)}', 'the component needs a key'],
    ['{wrap(links.map((link) => <NavLink key={link.href} {...link} />))}', 'the list must be the whole {…}, or a branch of a condition'],
    ['{open && links.map((link) => <NavLink {...link} />)}', 'the component needs a key'],
    ['{links.map((link) => <NavLink key={link.href} {...link}>{link.items.map((item) => <NavLink key={item.href} {...item} />)}</NavLink>)}', 'the repeated <NavLink> must take no content here: put it inside NavLink'],
  ])('reports %s', async (list, reason) => {
    const text = WITH_LIST.replace('{links.map((link) => <NavLink key={link.href} label={link.label} href={link.href} />)}', list);
    const root = await createProject({ ...TREE, [file]: text }, { appFiles: 'app' });
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code === 'list-shape-invalid');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain(reason);
  });
});
