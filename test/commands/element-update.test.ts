import { describe, expect, it } from 'vitest';
import { elementUpdateCommand } from '../../src/commands/element/update/command.js';
import { createProject, read, issuesOfUsedCode } from '../helpers.js';

const dir = 'src/app/components/NavMenu';
const file = `${dir}/NavMenu.tsx`;
const id = 'app/components/NavMenu/NavMenu.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const NAV_MENU = lines(
  "import styles from './NavMenu.module.css';",
  "import { ChevronDown } from 'lucide-react';",
  '',
  'export interface NavMenuProps {',
  '  label: string;',
  '  href: string;',
  '}',
  '',
  'export const NavMenu: React.FC<NavMenuProps> = () => {',
  '  return (',
  '    <nav className={styles.root}>',
  '      <button>Menu<ChevronDown size={16} /></button>',
  '      <a href="/x">Old</a>',
  '      <span />',
  '      <button>',
  '        <ChevronDown />',
  '      </button>',
  '      <div />',
  '    </nav>',
  '  );',
  '};',
);

async function update(target: string, options: { text?: string; props?: string; removeProps?: string }, text = NAV_MENU) {
  const root = await createProject(
    { [file]: text, [`${dir}/NavMenu.module.css`]: '.root {\n}\n', [`${dir}/index.ts`]: "export { NavMenu } from './NavMenu';\n" },
    { appFiles: 'app' },
  );
  const result = await elementUpdateCommand.run({ cwd: root, args: { target }, options: { text: options.text, message: undefined, props: options.props, removeProps: options.removeProps, dryRun: false } });
  return { root, result, text: await read(root, file) };
}

describe('element update: a list', () => {
  const item = 'src/app/components/NavItem';
  const LIST = [
    "import { NavItem } from '@/app/components/NavItem';",
    "import styles from './NavMenu.module.css';",
    '',
    'export interface NavMenuProps {',
    '  links: { id: string; label: string; description: string }[];',
    '}',
    '',
    'export const NavMenu: React.FC<NavMenuProps> = ({ links }) => {',
    '  return (',
    '    <nav className={styles.root}>',
    "      {links.map((link) => <NavItem key={link.id} label={link.label} description='' />)}",
    '    </nav>',
    '  );',
    '};',
    '',
  ].join('\n');

  async function listProject() {
    return createProject(
      {
        [file]: LIST,
        [`${dir}/NavMenu.module.css`]: '.root {\n}\n',
        [`${dir}/index.ts`]: "export { NavMenu } from './NavMenu';\n",
        [`${item}/NavItem.tsx`]: "import styles from './NavItem.module.css';\n\nexport interface NavItemProps {\n  label: string;\n  description: string;\n}\n\nexport const NavItem: React.FC<NavItemProps> = ({ label, description }) => {\n  return <span className={styles.root} title={description}>{label}</span>;\n};\n",
        [`${item}/NavItem.module.css`]: '.root {\n}\n',
        [`${item}/index.ts`]: "export { NavItem } from './NavItem';\n",
      },
      { appFiles: 'app' },
    );
  }
  const run = (root: string, options: { props?: string; removeProps?: string; text?: string }) =>
    elementUpdateCommand.run({ cwd: root, args: { target: `${id}#root/{links}` }, options: { text: options.text, message: undefined, props: options.props, removeProps: options.removeProps, dryRun: false } });

  it('sets the props of the component it repeats, with the item\'s values, on every item at once', async () => {
    const root = await listProject();
    const result = await run(root, { props: 'description={link.description}' });
    expect(result.issues ?? []).toEqual([]);
    expect(result.ok).toBe(true);
    expect(await read(root, file)).toContain('{links.map((link) => <NavItem key={link.id} label={link.label} description={link.description} />)}');
  });

  it('refuses a text, and removing the key', async () => {
    const root = await listProject();
    expect((await run(root, { text: 'Hi' })).issues?.map((issue) => issue.code)).toEqual(['update-not-an-element']);
    expect((await run(root, { removeProps: 'key' })).issues?.map((issue) => issue.code)).toEqual(['list-prop-fixed']);
    expect(await read(root, file)).toBe(LIST);
  });
});

describe('element update', () => {
  it('replaces the text and keeps the icon, destructuring the prop it shows', async () => {
    const { root, result, text } = await update(`${id}#nav/button[1]`, { text: '{label}' });
    expect(result.ok).toBe(true);
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'updated the text of <button> #root/button[1]' }]);
    expect(text).toContain('export const NavMenu: React.FC<NavMenuProps> = ({ label }) => {');
    expect(text).toContain('<button>{label}<ChevronDown size={16} /></button>');
    expect(await issuesOfUsedCode(root)).toEqual([]);
  });

  it('updates the text and the link of an "a"', async () => {
    const { text } = await update(`${id}#nav/a`, { text: 'Go to {label}', props: 'href={href}' });
    expect(text).toContain('= ({ label, href }) => {');
    expect(text).toContain('<a href={href}>Go to {label}</a>');
  });

  it('adds a link to an "a" that has none', async () => {
    const { text } = await update(`${id}#nav/a`, { props: 'href="/docs"' }, NAV_MENU.replace('<a href="/x">', '<a>'));
    expect(text).toContain('<a href="/docs">Old</a>');
  });

  it('gives text to an empty element, or to one holding only an icon', async () => {
    expect((await update(`${id}#nav/span`, { text: 'Hi' })).text).toContain('      <span>Hi</span>\n');
    expect((await update(`${id}#nav/button[2]`, { text: 'Theme' })).text).toContain('      <button>\n        <ChevronDown />\n        Theme\n      </button>\n');
  });

  it.each([
    [`${id}#nav/a`, {}, 'element-update-nothing'],
    [`${id}#nav/div`, { text: 'Hi' }, 'element-text-not-allowed'],
    [`${id}#nav/span`, { props: 'title={a ? b : c}' }, 'value-expression-not-allowed'],
    [`${id}#nav/span`, { text: '{title}' }, 'value-name-unknown'],
    [`${id}#nav/span`, { text: '{label.toUpperCase()}' }, 'value-expression-not-allowed'],
  ])('refuses %s with %j', async (target, options, code) => {
    const { result, text } = await update(target, options);
    expect(result.issues?.map((issue) => issue.code)).toEqual([code]);
    expect(text).toBe(NAV_MENU);
  });
});

describe('element update --text: what was written by hand', () => {
  it('refuses a text element holding code or an element, and changes nothing', async () => {
    const condition = NAV_MENU.replace('<span />', "<span>{label === 'x' && <ChevronDown />}{label}</span>").replace('= () =>', '= ({ label }) =>');
    const refused = await update(`${id}#nav/span`, { text: 'New' }, condition);
    expect(refused.result.issues?.map((issue) => issue.code)).toEqual(['element-text-hand-written']);
    expect(refused.result.issues?.[0]?.message).toBe("<span> holds {label === 'x' && <ChevronDown />} (line 14), which was written by hand.");
    expect(refused.text).toBe(condition);

    const formatted = NAV_MENU.replace('<span />', '<span>Read <strong>this</strong></span>');
    expect((await update(`${id}#nav/span`, { text: 'New' }, formatted)).result.issues?.map((issue) => issue.code)).toEqual(['element-text-hand-written']);
  });

  it('keeps the elements of an interactive element, but refuses its code', async () => {
    const code = NAV_MENU.replace('<button>Menu<ChevronDown size={16} /></button>', '<button>{open ? "Close" : "Menu"}<ChevronDown size={16} /></button>');
    expect((await update(`${id}#nav/button[1]`, { text: 'New' }, code)).result.issues?.map((issue) => issue.code)).toEqual(['element-text-hand-written']);
  });

  it('removes what only the old text used: the prop or the import of a constant', async () => {
    const shown = NAV_MENU.replace('= () =>', '= ({ label, href }) =>').replace('<span />', '<span>{label}</span>').replace('<a href="/x">Old</a>', '<a href={href}>{TITLE.short}</a>');
    const withConstant = shown.replace("import { ChevronDown } from 'lucide-react';", "import { ChevronDown } from 'lucide-react';\nimport { TITLE } from '../../constants';");
    const prop = await update(`${id}#nav/span`, { text: 'Plain' }, withConstant);
    expect(prop.result.issues).toEqual([]);
    expect(prop.text).toContain('= ({ href }) =>');
    expect(prop.text).toContain('<span>Plain</span>');

    const constant = await update(`${id}#nav/a`, { text: 'Docs' }, withConstant);
    expect(constant.text).not.toContain('TITLE');
    expect(constant.text).toContain('= ({ label, href }) =>');

    const last = await update(`${id}#nav/span`, { text: 'Plain' }, NAV_MENU.replace('= () =>', '= ({ label }) =>').replace('<span />', '<span>{label}</span>'));
    expect(last.text).toContain('= () =>');
  });

  it('removes the import a replaced or removed prop value alone used', async () => {
    const withConstant = NAV_MENU.replace("import { ChevronDown } from 'lucide-react';", "import { ChevronDown } from 'lucide-react';\nimport { LINKS, TITLE } from '../../constants';").replace(
      '<a href="/x">Old</a>',
      '<a href={LINKS.home} title={TITLE.en}>Old</a>',
    );
    const replaced = await update(`${id}#nav/a`, { props: "href='/'" }, withConstant);
    expect(replaced.result.issues).toEqual([]);
    expect(replaced.text).toContain("import { TITLE } from '../../constants';");
    expect(replaced.text).toContain("<a href='/' title={TITLE.en}>Old</a>");

    const removed = await update(`${id}#nav/a`, { removeProps: 'title' }, withConstant);
    expect(removed.text).toContain("import { LINKS } from '../../constants';");
  });

  it('keeps a variable of the component written by hand, with a warning', async () => {
    const local = NAV_MENU.replace('  return (\n', '  const today = new Date().toDateString();\n  return (\n').replace('<span />', '<span>{today}</span>');
    const { result, text } = await update(`${id}#nav/span`, { text: 'Plain' }, local);
    expect(result.ok).toBe(true);
    expect(result.issues?.map((issue) => [issue.severity, issue.code])).toEqual([['warning', 'variable-unused']]);
    expect(text).toContain('const today');
  });
});

describe('element update --remove-props', () => {
  it('removes a prop, and "children" empties the element, dropping the imports nothing else uses', async () => {
    const link = await update(`${id}#nav/a`, { removeProps: 'href' });
    expect(link.result.issues).toEqual([]);
    expect(link.text).toContain('      <a>Old</a>\n');

    const emptied = await update(`${id}#nav`, { removeProps: 'children' });
    expect(emptied.result.issues).toEqual([]);
    expect(emptied.text).toContain('    <nav className={styles.root} />');
    expect(emptied.text).not.toContain('ChevronDown');
  });

  it.each([
    [{ removeProps: 'title' }, 'prop-missing'],
    [{ removeProps: 'href', props: 'href="/y"' }, 'options-conflict'],
  ])('refuses %j', async (options, code) => {
    const { result } = await update(`${id}#nav/a`, options);
    expect(result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('refuses to remove a prop the component requires', async () => {
    const card = 'src/app/components/Card';
    const root = await createProject(
      {
        [`${card}/Card.tsx`]: 'export interface CardProps {\n  title: string;\n  subtitle?: string;\n}\n\nexport const Card: React.FC<CardProps> = () => <div />;\n',
        [`${card}/index.ts`]: "export { Card } from './Card';\n",
        [file]: "import { Card } from '../Card';\n\nexport const NavMenu: React.FC = () => {\n  return (\n    <nav>\n      <Card title='Docs' subtitle='Guides' />\n    </nav>\n  );\n};\n",
      },
      { appFiles: 'app' },
    );
    const run = (removeProps: string) => elementUpdateCommand.run({ cwd: root, args: { target: `${id}#nav/Card` }, options: { text: undefined, message: undefined, props: undefined, removeProps, dryRun: false } });
    expect((await run('title')).issues?.map((issue) => issue.code)).toEqual(['props-required']);
    expect((await run('subtitle')).issues).toEqual([]);
    expect(await read(root, file)).toContain("<Card title='Docs' />");
  });
});
