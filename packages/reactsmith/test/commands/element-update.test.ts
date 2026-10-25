import { describe, expect, it } from 'vitest';
import { elementUpdateCommand } from '../../src/commands/element/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

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
  const result = await elementUpdateCommand.run({ cwd: root, args: { target }, options: { text: options.text, props: options.props, removeProps: options.removeProps, dryRun: false } });
  return { root, result, text: await read(root, file) };
}

describe('element update', () => {
  it('replaces the text and keeps the icon, destructuring the prop it shows', async () => {
    const { root, result, text } = await update(`${id}#nav/button[1]`, { text: '{label}' });
    expect(result.ok).toBe(true);
    expect(result.actions).toEqual([{ type: 'update', path: file, message: 'updated the text of <button> nav/button[1]' }]);
    expect(text).toContain('export const NavMenu: React.FC<NavMenuProps> = ({ label }) => {');
    expect(text).toContain('<button>{label}<ChevronDown size={16} /></button>');
    expect((await checkStructure(root)).issues).toEqual([]);
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
    const run = (removeProps: string) => elementUpdateCommand.run({ cwd: root, args: { target: `${id}#nav/Card` }, options: { text: undefined, props: undefined, removeProps, dryRun: false } });
    expect((await run('title')).issues?.map((issue) => issue.code)).toEqual(['props-required']);
    expect((await run('subtitle')).issues).toEqual([]);
    expect(await read(root, file)).toContain("<Card title='Docs' />");
  });
});
