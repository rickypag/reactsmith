import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { styleTypographyCommand } from '../../src/commands/style/typography/command.js';
import { styleUpdateCommand } from '../../src/commands/style/update/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const file = `${dir}/TopBar.tsx`;
const css = `${dir}/TopBar.module.css`;
const tailwindStyles = `${dir}/TopBar.styles.ts`;
const id = 'app/components/TopBar/TopBar.tsx';
const lines = (...text: string[]) => `${text.join('\n')}\n`;

const TOP_BAR = lines(
  "import styles from './TopBar.module.css';",
  '',
  'export const TopBar: React.FC = () => {',
  '  return (',
  '    <header className={styles.root}>',
  '      <nav className={styles.links} />',
  '      <button className={styles.menu}>Menu</button>',
  '    </header>',
  '  );',
  '};',
);
const TOP_BAR_CSS = lines('.root {', '  display: flex;', '}', '', '.links {', '  display: flex;', '}', '', '.menu {', '  display: none;', '}');

const TAILWIND_TOP_BAR = TOP_BAR.replace("import styles from './TopBar.module.css';", "import { styles } from './TopBar.styles';");
const TAILWIND_STYLES = lines('export const styles = {', "  root: 'flex',", "  links: 'flex gap-2',", "  menu: 'hidden',", '};');

interface Options {
  css?: string;
  class?: string;
  direction?: 'row' | 'column' | 'none';
  gap?: string;
  state?: 'hover';
  at?: string;
}

const run = (root: string, target: string, options: Options) =>
  styleUpdateCommand.run({
    cwd: root,
    args: { target },
    options: {
      name: undefined, state: options.state, when: undefined, css: options.css, cssFile: undefined, object: undefined, objectFile: undefined, class: options.class,
      direction: options.direction, gap: options.gap, align: undefined, justify: undefined, padding: undefined, at: options.at, dryRun: false,
    },
  });

const cssProject = (config: object = {}, styles = TOP_BAR_CSS) =>
  createProject({ [file]: TOP_BAR, [css]: styles, [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n" }, { appFiles: 'app', ...config });

describe('style update --at, with CSS Modules', () => {
  it("writes the declarations in the breakpoint's @media block, at the end of the style file", async () => {
    const root = await cssProject();
    expect((await run(root, `${id}#links`, { at: 'mobile', css: 'display: none' })).ok).toBe(true);
    expect((await run(root, `${id}#menu`, { at: 'mobile', css: 'display: inline-flex' })).ok).toBe(true);
    expect((await run(root, `${id}#root`, { at: 'mobile', direction: 'column', gap: '2' })).ok).toBe(true);

    expect(await read(root, css)).toBe(
      lines(
        '.root {', '  display: flex;', '}', '', '.links {', '  display: flex;', '}', '', '.menu {', '  display: none;', '}', '',
        '@media (max-width: 767px) {',
        '  .links {', '    display: none;', '  }', '',
        '  .menu {', '    display: inline-flex;', '  }', '',
        '  .root {', '    display: flex;', '    flex-direction: column;', '    gap: var(--space-2);', '  }',
        '}',
      ),
    );
  });

  it('keeps the base rules before the breakpoints, whatever order the commands ran in', async () => {
    const root = await cssProject({}, lines('.root {', '  display: flex;', '}'));
    await run(root, `${id}#menu`, { at: 'mobile', css: 'display: inline-flex' });
    // The menu's first base rule comes after: it must still go above the @media block, or it would override it.
    await run(root, `${id}#menu`, { css: 'display: none' });
    const text = await read(root, css);
    expect(text.indexOf('.menu {\n  display: none;')).toBeLessThan(text.indexOf('@media'));
    expect(text).toContain('@media (max-width: 767px) {\n  .menu {\n    display: inline-flex;\n  }\n}');
  });

  it('writes states inside the breakpoint, and the blocks in the order of the breakpoints', async () => {
    const root = await cssProject({ breakpoints: { tablet: '(max-width: 1023px)', mobile: '(max-width: 767px)' } });
    await run(root, `${id}#links`, { at: 'mobile', css: 'display: none' });
    await run(root, `${id}#links`, { at: 'tablet', state: 'hover', css: 'opacity: 0.8' });
    const text = await read(root, css);
    expect(text.indexOf('@media (max-width: 1023px)')).toBeLessThan(text.indexOf('@media (max-width: 767px)'));
    expect(text).toContain('@media (max-width: 1023px) {\n  .links:hover:not(:disabled) {\n    opacity: 0.8;\n  }\n}');
  });

  it('passes check, and says what is changed at which breakpoint', async () => {
    const root = await cssProject();
    const result = await run(root, `${id}#links`, { at: 'mobile', css: 'display: none' });
    expect(result.actions?.[0]?.message).toBe('style "links" (at mobile)');
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code.startsWith('breakpoint'));
    expect(issues).toEqual([]);
  });

  it('refuses a breakpoint the config does not have, listing the ones it has', async () => {
    const root = await cssProject();
    const result = await run(root, `${id}#links`, { at: 'tablet', css: 'display: none' });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'breakpoint-unknown', message: '"tablet" is not a breakpoint.', hint: 'The breakpoints are mobile: add others to "breakpoints" in reactsmith.config.json.' }),
    ]);
  });
});

describe('style update --at, with Tailwind', () => {
  const tailwindProject = () =>
    createProject(
      {
        [file]: TAILWIND_TOP_BAR,
        [tailwindStyles]: TAILWIND_STYLES,
        [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
        'src/app/styles/global.css': '@import "tailwindcss";\n@import \'./tokens/colors.css\';\n\n:root {\n  color-scheme: light dark;\n}\n',
      },
      { appFiles: 'app', styles: 'tailwind' },
    );

  it('writes the classes with the breakpoint as a prefix, and its variant in the global stylesheet', async () => {
    const root = await tailwindProject();
    await run(root, `${id}#links`, { at: 'mobile', css: 'display: none' });
    await run(root, `${id}#root`, { at: 'mobile', direction: 'column' });
    const styles = await read(root, tailwindStyles);
    expect(styles).toContain("links: 'flex gap-2 mobile:[display:none]'");
    expect(styles).toContain("root: 'flex mobile:flex mobile:flex-col'");
    expect(await read(root, 'src/app/styles/global.css')).toBe(
      '@import "tailwindcss";\n@import \'./tokens/colors.css\';\n@custom-variant mobile (@media (max-width: 767px));\n\n:root {\n  color-scheme: light dark;\n}\n',
    );
    expect((await checkStructure(root)).issues.filter((issue) => issue.code.startsWith('breakpoint'))).toEqual([]);
  });

  it('replaces the classes of the breakpoint, keeping the others', async () => {
    const root = await tailwindProject();
    await run(root, `${id}#links`, { at: 'mobile', gap: '1' });
    await run(root, `${id}#links`, { at: 'mobile', gap: '4' });
    expect(await read(root, tailwindStyles)).toContain("links: 'flex gap-2 mobile:flex mobile:gap-4'");
  });

  it('writes the variants with --class too, since its classes may use a breakpoint', async () => {
    const root = await tailwindProject();
    await run(root, `${id}#links`, { class: 'flex mobile:hidden' });
    expect(await read(root, 'src/app/styles/global.css')).toContain('@custom-variant mobile (@media (max-width: 767px));');
  });

  it('refuses --class with --at: the classes already say their breakpoint', async () => {
    const root = await tailwindProject();
    const result = await run(root, `${id}#links`, { at: 'mobile', class: 'hidden' });
    expect(result.issues?.map((issue) => issue.code)).toEqual(['options-conflict']);
  });
});

describe('breakpoints and the size tokens', () => {
  it('give the tokens their modes: a value per breakpoint, in the order of the breakpoints, each optional', async () => {
    const root = await createProject({}, { appFiles: 'app', breakpoints: { tablet: '(max-width: 1023px)', mobile: '(max-width: 767px)' } });
    const set = (value: string, mode?: string) => styleTypographyCommand.run({ cwd: root, args: {}, options: { set: `size/heading=${value}`, mode, remove: undefined, dryRun: false } });
    expect((await set('2rem')).ok).toBe(true);
    expect((await set('1.25rem', 'mobile')).ok).toBe(true);
    expect((await set('1.5rem', 'tablet')).ok).toBe(true);

    const cssText = await read(root, 'src/app/styles/tokens/typography.css');
    expect(cssText.indexOf('@media (max-width: 1023px)')).toBeLessThan(cssText.indexOf('@media (max-width: 767px)'));
    expect(cssText).toContain('@media (max-width: 767px) {\n  :root {\n    --text-heading: 1.25rem;\n  }\n}');
    expect(JSON.parse(await read(root, 'src/app/styles/tokens/typography.json')).size.heading).toEqual({ desktop: '2rem', mobile: '1.25rem', tablet: '1.5rem' });
    expect((await checkStructure(root)).issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('warn about a token file that still holds its own modes', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    await styleTypographyCommand.run({ cwd: root, args: {}, options: { set: undefined, mode: undefined, remove: undefined, dryRun: false } });
    const jsonRel = 'src/app/styles/tokens/typography.json';
    const tree = JSON.parse(await read(root, jsonRel));
    await writeFile(path.join(root, jsonRel), JSON.stringify({ $modes: ['desktop', 'mobile'], $media: { mobile: '(max-width: 767px)' }, ...tree }, null, 2));
    const issues = (await checkStructure(root)).issues.filter((issue) => issue.code === 'typography-modes-moved');
    expect(issues).toHaveLength(1);
  });
});

describe('style update: focus-within and parts of the element', () => {
  it('writes :focus-within and ::placeholder rules in CSS, and their variants in Tailwind', async () => {
    const root = await cssProject();
    expect((await run(root, `${id}#links`, { css: 'gap: 4px; &:focus-within { outline: 2px solid var(--color-primary) } &::placeholder { color: gray }' })).issues).toEqual([]);
    const written = await read(root, css);
    expect(written).toContain('.links:focus-within {\n  outline: 2px solid var(--color-primary);\n}');
    expect(written).toContain('.links::placeholder {\n  color: gray;\n}');

    const tailwind = await createProject(
      { [file]: TAILWIND_TOP_BAR, [tailwindStyles]: TAILWIND_STYLES, [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n" },
      { appFiles: 'app', styles: 'tailwind' },
    );
    expect((await run(tailwind, `${id}#links`, { css: '&:focus-within { opacity: 0.5 } &::before { content: "" }' })).issues).toEqual([]);
    expect(await read(tailwind, tailwindStyles)).toContain('focus-within:[opacity:0.5] before:[content:""]');
  });
});
