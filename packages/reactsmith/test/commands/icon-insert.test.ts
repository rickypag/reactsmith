import { describe, expect, it } from 'vitest';
import { iconInsertCommand } from '../../src/commands/icon/insert/command.js';
import { runInit } from '../../src/commands/init/init.js';
import { CONFIG_FILE } from '../../src/shared/config/defaults.js';
import { iconComponentName } from '../../src/shared/icons/library.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read, VITE_PROJECT } from '../helpers.js';

/** A stand-in for lucide-react: each icon is exported three times, as the real package does. */
const LUCIDE = {
  'node_modules/lucide-react/package.json': '{ "name": "lucide-react", "main": "index.js" }',
  'node_modules/lucide-react/index.js': [
    'const icon = {};',
    'module.exports = {',
    '  ArrowRight: icon, ArrowRightIcon: icon, LucideArrowRight: icon,',
    '  Menu: icon, MenuIcon: icon, LucideMenu: icon,',
    '  BookOpen: icon, BookOpenIcon: icon, LucideBookOpen: icon,',
    '  Icon: icon, createLucideIcon() {}, icons: {},',
    '};',
  ].join('\n'),
};

const file = 'src/app/components/TopBar/TopBar.tsx';
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = lines(
  "import styles from './TopBar.module.css';",
  "import { Card } from '../Card';",
  '',
  'export const TopBar: React.FC = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <button>Read the docs</button>',
  '      <Card />',
  '    </header>',
  '  );',
  '};',
);

const config = { appFiles: 'app', icons: { library: 'lucide-react' } };

async function insert(icon: string, into: string, options: { position?: 'inside' | 'first' | 'before' | 'after'; size?: string } = {}, tree: Record<string, string> = {}, cfg: object = config) {
  const root = await createProject({ ...LUCIDE, [file]: TOP_BAR, ...tree }, cfg);
  const result = await iconInsertCommand.run({ cwd: root, args: { icon }, options: { into, position: options.position, size: options.size, dryRun: false } });
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

describe('icon insert', () => {
  it('puts an icon next to the text of a button, and imports it', async () => {
    const { result, text } = await insert('book-open', `${id}#header/button`, { position: 'first', size: '16' });
    expect(result.summary).toBe(`Inserted the icon "BookOpen" into ${file}.`);
    expect(text).toContain('      <button><BookOpen size={16} />Read the docs</button>\n');
    expect(text).toContain("import { BookOpen } from 'lucide-react';\n");
  });

  it('extends the existing import for more icons, and goes into layout elements', async () => {
    const first = await insert('menu', `${id}#header`, { position: 'first' });
    expect(first.text).toContain('    <header className={styles.root}>\n      <Menu />\n      <button>');
    const tree = { [file]: first.text };
    const second = await insert('arrow-right', `${id}#header/button`, {}, tree);
    expect(second.text).toContain("import { Menu, ArrowRight } from 'lucide-react';\n");
    expect(second.text).toContain('<button>Read the docs<ArrowRight /></button>');
    expect((await insert('menu', `${id}#header`, {}, tree)).text.match(/import \{ Menu \}/g)).toHaveLength(1);
  });

  it('suggests close names for an unknown icon', async () => {
    const { result } = await insert('arow-right', `${id}#header`);
    expect(result.issues?.map((issue) => `${issue.code}: ${issue.hint}`)).toEqual(['icon-not-found: Did you mean ArrowRight?']);
  });

  it.each([
    [`${id}#header/Card`, {}, 'insert-target-not-layout'],
    [`${id}#header`, { position: 'after' }, 'insert-target-not-layout'],
    [`${id}#header`, { size: 'big' }, 'icon-size-invalid'],
  ])('refuses %s %j', async (target, options, code) => {
    expect((await insert('menu', target, options as { position?: 'after'; size?: string })).result.issues?.map((issue) => issue.code)).toEqual([code]);
  });

  it('needs a configured and installed icon library', async () => {
    const notConfigured = await insert('menu', `${id}#header`, {}, {}, { appFiles: 'app' });
    expect(notConfigured.result.issues?.map((issue) => issue.code)).toEqual(['icons-not-configured']);

    const root = await createProject({ [file]: TOP_BAR }, config);
    const missing = await iconInsertCommand.run({ cwd: root, args: { icon: 'menu' }, options: { into: `${id}#header`, position: undefined, size: undefined, dryRun: false } });
    expect(missing.issues?.map((issue) => issue.code)).toEqual(['icons-not-installed']);
  });
});

describe('icons in init and check', () => {
  it('records lucide-react when it is installed', async () => {
    const root = await createProject({ ...VITE_PROJECT, 'package.json': JSON.stringify({ name: 'app', dependencies: { 'lucide-react': '^0.460.0' } }) });
    await runInit(root, { appFiles: 'root' });
    expect(JSON.parse(await read(root, CONFIG_FILE)).icons).toEqual({ library: 'lucide-react' });
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
