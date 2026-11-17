import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { runInit } from '../../src/commands/init/init.js';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { iconComponentName } from '../../src/shared/icons/library.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read, VITE_PROJECT } from '../helpers.js';

/** A stand-in for lucide-react: each icon is exported three times, as the real package does. */
const LUCIDE = {
  'package.json': JSON.stringify({ name: 'app', dependencies: { 'lucide-react': '*' } }),
  'node_modules/lucide-react/package.json': '{ "name": "lucide-react", "main": "index.js", "types": "index.d.ts" }',
  'node_modules/lucide-react/index.js': [
    'const icon = {};',
    'module.exports = {',
    '  ArrowRight: icon, ArrowRightIcon: icon, LucideArrowRight: icon,',
    '  Menu: icon, MenuIcon: icon, LucideMenu: icon,',
    '  BookOpen: icon, BookOpenIcon: icon, LucideBookOpen: icon,',
    '  Icon: icon, createLucideIcon() {}, icons: {},',
    '};',
  ].join('\n'),
  'node_modules/lucide-react/index.d.ts': ['ArrowRight', 'Menu', 'BookOpen']
    .flatMap((name) => [name, `${name}Icon`, `Lucide${name}`])
    .map((name) => `export declare const ${name}: (props: { size?: number | string }) => null;\n`)
    .join(''),
};

const file = 'src/app/components/TopBar/TopBar.tsx';
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = lines(
  "import styles from './TopBar.module.css';",
  '',
  'export const TopBar: React.FC = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <button>Read the docs</button>',
  '      <span>Docs</span>',
  '    </header>',
  '  );',
  '};',
);

const config = { appFiles: 'app', icons: { library: 'lucide-react' } };

async function insert(icon: string, into: string, options: { position?: 'inside' | 'first' | 'before' | 'after'; props?: string } = {}, tree: Record<string, string> = {}) {
  const root = await createProject({ ...LUCIDE, [file]: TOP_BAR, 'src/app/components/TopBar/TopBar.module.css': '.root {\n}\n', ...tree }, config);
  const result = await elementInsertCommand.run({
    cwd: root,
    args: { name: icon },
    options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into, position: options.position, from: undefined, props: options.props, text: undefined, message: undefined, name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
  });
  return { root, result, text: await read(root, file) };
}

describe('iconComponentName', () => {
  it.each([
    ['arrow-right', 'ArrowRight'],
    ['ArrowRight', 'ArrowRight'],
    ['arrow right', 'ArrowRight'],
    ['ArrowRightIcon', 'ArrowRight'],
    ['LucideArrowRight', 'ArrowRight'],
    ['menu', 'Menu'],
  ])('%s → %s', (input, name) => {
    expect(iconComponentName(input)).toBe(name);
  });
});

describe('icons with element insert', () => {
  it('puts an icon next to the text of a button, and imports it', async () => {
    const { result, text } = await insert('BookOpenIcon', `${id}#header/button`, { position: 'first', props: 'size={16}' });
    expect(result.issues ?? []).toEqual([]);
    expect(text).toContain('      <button><BookOpenIcon size={16} />Read the docs</button>\n');
    expect(text).toContain("import { BookOpenIcon } from 'lucide-react';\n");
  });

  it('extends the existing import for more icons, and goes into layout elements', async () => {
    const first = await insert('MenuIcon', `${id}#header`, { position: 'first' });
    expect(first.text).toContain('    <header className={styles.root}>\n      <MenuIcon />\n      <button>');
    const second = await insert('ArrowRightIcon', `${id}#header/button`, {}, { [file]: first.text });
    expect(second.text).toContain("import { MenuIcon, ArrowRightIcon } from 'lucide-react';\n");
    expect(second.text).toContain('<button>Read the docs<ArrowRightIcon /></button>');
  });

  it('suggests close names for an unknown icon, and the Icon suffix for a bare name', async () => {
    const typo = await insert('ArowRightIcon', `${id}#header`);
    expect(typo.result.issues?.map((issue) => `${issue.code}: ${issue.hint}`)).toEqual(['icon-not-found: Did you mean ArrowRightIcon?']);
    const bare = await insert('Menu', `${id}#header`);
    expect(bare.result.issues?.map((issue) => issue.code)).toEqual(['icon-name']);
    expect(bare.result.issues?.[0]?.hint).toContain('Insert MenuIcon');
  });

  it('refuses a text element, which holds only text: the icon goes next to it', async () => {
    const into = await insert('MenuIcon', `${id}#header/span`);
    expect(into.result.issues?.map((issue) => issue.code)).toEqual(['insert-target-not-layout']);
    expect((await insert('MenuIcon', `${id}#header/span`, { position: 'before' })).text).toContain('      <MenuIcon />\n      <span>Docs</span>');
  });
});

describe('icons in init and check', () => {
  it('records lucide-react when it is installed', async () => {
    const root = await createProject({ ...VITE_PROJECT, 'package.json': JSON.stringify({ name: 'app', dependencies: { 'lucide-react': '^0.460.0' } }) });
    await runInit(root, { appFiles: 'root' });
    expect(JSON.parse(await read(root, CONFIG_FILE)).icons).toEqual({ library: 'lucide-react' });
  });

  it('reports icons imported without the Icon suffix', async () => {
    const root = await createProject({ 'src/app/components/Nav/Nav.tsx': "import { MenuIcon, Search, LucideUser as U } from 'lucide-react';\nimport type { LucideProps } from 'lucide-react';\n" }, config);
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code === 'icon-name');
    expect(issues.map((issue) => issue.message)).toEqual([
      '"Search" is imported from lucide-react without the Icon suffix.',
      '"LucideUser" is imported from lucide-react without the Icon suffix.',
    ]);
  });

  it('reports imports from another icon library', async () => {
    const root = await createProject(
      {
        'src/app/components/Nav/Nav.tsx': "import { Menu } from 'lucide-react';\nimport GitHubIcon from '@mui/icons-material/GitHub';\nimport { FaHome } from 'react-icons/fa';\n",
      },
      config,
    );
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code === 'icon-library-mixed');
    expect(issues.map((issue) => `${issue.severity} ${issue.message}`)).toEqual([
      'error "@mui/icons-material/GitHub" is another icon library, but the project uses lucide-react.',
      'error "react-icons/fa" is another icon library, but the project uses lucide-react.',
    ]);
  });
});
