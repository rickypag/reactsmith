import { describe, expect, it } from 'vitest';
import { styleConvertCommand } from '../../src/commands/style/convert/command.js';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, exists, read } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = lines(
  "import { styles } from './TopBar.styles';",
  "import { Fragment } from 'react';",
  '',
  'export const TopBar: React.FC = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <a className={styles.link} href="/">Home</a>',
  '      <span className={styles.spinner} />',
  '    </header>',
  '  );',
  '};',
);
const STYLES = lines(
  'export const styles = {',
  "  root: 'group flex flex-row gap-2 items-center justify-between py-2 px-4 shrink-0 border-b border-border',",
  "  link: '[font-size:13px] [letter-spacing:1.3px] [text-transform:uppercase] [font-family:var(--font-sans)] not-disabled:hover:[color:var(--color-primary)] aria-[current=page]:[font-weight:700] group-data-[tone=dark]:[color:var(--color-bg)] nav:[font-size:12px]',",
  "  spinner: 'animate-spin backdrop-blur-sm [width:24px] [border:2px_solid_var(--color-primary)]',",
  '};',
);

const project = () =>
  createProject(
    {
      [`${dir}/TopBar.tsx`]: TOP_BAR,
      [`${dir}/TopBar.styles.ts`]: STYLES,
      [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
      'src/app/App.tsx': "import { TopBar } from './components/TopBar';\n\nexport const App = () => <TopBar />;\n",
      'src/app/styles/global.css': '@import "tailwindcss";\n@custom-variant nav (@media (max-width: 1023px));\n',
      // create-next-app's Tailwind setup: every .css through Tailwind's loader, as plain CSS.
      'next.config.ts': 'const nextConfig = {\n  turbopack: {\n    rules: {\n      "*.css": {\n        loaders: ["@tailwindcss/turbopack"],\n        as: "*.css",\n      },\n    },\n  },\n};\n\nexport default nextConfig;\n',
    },
    { appFiles: 'app', styles: 'tailwind', breakpoints: { nav: '(max-width: 1023px)', mobile: '(max-width: 767px)' } },
  );

const convert = (root: string, dryRun = false) => styleConvertCommand.run({ cwd: root, args: {}, options: { to: 'css-modules', dryRun } });

describe('style convert --to css-modules', () => {
  it('turns each styles file into a CSS module, with its import, the config and the tokens', async () => {
    const root = await project();
    const result = await convert(root);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Converted 1 style file to CSS Modules.');

    expect(await exists(root, `${dir}/TopBar.styles.ts`)).toBe(false);
    expect(await read(root, `${dir}/TopBar.module.css`)).toBe(
      lines(
        '.root {',
        '  display: flex;',
        '  flex-direction: row;',
        '  gap: var(--space-2);',
        '  align-items: center;',
        '  justify-content: space-between;',
        '  padding: var(--space-2) var(--space-4);',
        '  flex-shrink: 0;',
        '  border-bottom-width: 1px;',
        '  border-bottom-style: solid;',
        '  border-color: var(--color-border);',
        '}',
        '',
        '.link {',
        '  font-size: 13px;',
        '  letter-spacing: 1.3px;',
        '  text-transform: uppercase;',
        '  font-family: var(--font-sans);',
        '}',
        '',
        '.link:hover:not(:disabled) {',
        '  color: var(--color-primary);',
        '}',
        '',
        '.root[data-tone="dark"] .link {',
        '  color: var(--color-bg);',
        '}',
        '',
        '.link[aria-current="page"] {',
        '  font-weight: 700;',
        '}',
        '',
        '.spinner {',
        '  /* Tailwind classes to write as CSS by hand: backdrop-blur-sm */',
        '  animation: spin 1s linear infinite;',
        '  width: 24px;',
        '  border: 2px solid var(--color-primary);',
        '}',
        '',
        '@media (max-width: 1023px) {',
        '  .link {',
        '    font-size: 12px;',
        '  }',
        '}',
        '',
        '@keyframes spin {',
        '  to {',
        '    transform: rotate(360deg);',
        '  }',
        '}',
      ),
    );
    // The CSS module is imported last, so a parent's rules for a child component load after the child's own.
    expect(await read(root, `${dir}/TopBar.tsx`)).toBe(TOP_BAR.replace("import { styles } from './TopBar.styles';\nimport { Fragment } from 'react';", "import { Fragment } from 'react';\nimport styles from './TopBar.module.css';"));
    expect(JSON.parse(await read(root, 'reactsmith.config.json')).styles).toBe('css-modules');
    // Tailwind's loader now reads only the global stylesheet, so CSS modules stay modules.
    expect(await read(root, 'next.config.ts')).toContain('"global.css": {\n        loaders: ["@tailwindcss/turbopack"],');
    expect(await read(root, 'src/app/styles/tokens/colors.css')).toContain(':root {');
    expect(result.issues?.map((issue) => issue.code)).toEqual(['style-classes-by-hand', 'styles-tailwind-still-imported']);

    // The project is valid, and the commands now write CSS.
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    const update = await styleUpdateCommand.run({
      cwd: root,
      args: { target: `${id}#link` },
      options: { name: undefined, state: undefined, when: undefined, css: 'font-size: 14px', cssFile: undefined, object: undefined, objectFile: undefined, class: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, at: undefined, dryRun: false },
    });
    expect(update.ok).toBe(true);
    expect(await read(root, `${dir}/TopBar.module.css`)).toContain('.link {\n  font-size: 14px;');
  });

  it('changes nothing in a dry run, and refuses a project already on CSS Modules', async () => {
    const root = await project();
    expect((await convert(root, true)).ok).toBe(true);
    expect(await read(root, `${dir}/TopBar.styles.ts`)).toBe(STYLES);
    await convert(root);
    expect((await convert(root)).issues?.map((issue) => issue.code)).toEqual(['styles-already-css-modules']);
  });
});
