import { describe, expect, it } from 'vitest';
import { styleTypographyCommand } from '../../src/commands/style/typography/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const jsonPath = 'src/app/styles/tokens/typography.json';
const cssPath = 'src/app/styles/tokens/typography.css';
const tsPath = 'src/app/styles/tokens/typography.ts';
const globalPath = 'src/app/styles/global.css';

type Options = Partial<Record<'set' | 'mode' | 'remove', string>>;

const typography = (root: string, options: Options) =>
  styleTypographyCommand.run({ cwd: root, args: {}, options: { set: options.set, mode: options.mode, remove: options.remove, dryRun: false } });

async function setTypography(options: Options, tree: Record<string, string> = {}, config: object = {}) {
  const root = await createProject(tree, { appFiles: 'app', ...config });
  return { root, result: await typography(root, options) };
}

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);
const json = async (root: string) => JSON.parse(await read(root, jsonPath));

describe('style typography', () => {
  it('writes the default typography: one variable per property, with Tailwind\'s prefixes, and their types', async () => {
    const { root, result } = await setTypography({});
    expect(result.summary).toBe('Typography written from typography.json.');
    const tree = await json(root);
    // The screen sizes are the breakpoints of the config, not a copy in the file.
    expect(tree.$modes).toBeUndefined();
    expect(tree.$media).toBeUndefined();
    const css = await read(root, cssPath);
    expect(css).toContain("  --font-sans: system-ui, 'Segoe UI', Roboto, sans-serif;\n");
    expect(css).toContain('  --text-base: 1rem;\n');
    expect(css).toContain('  --font-weight-bold: 700;\n');
    expect(css).toContain('  --leading-normal: 1.5;\n');
    expect(css).toContain('  --tracking-tight: -0.025em;\n');
    const ts = await read(root, tsPath);
    expect(ts).toContain("  'family': [\n    'sans',\n    'mono',\n  ],");
    expect(ts).toContain("export type FontSizeToken = (typeof TYPOGRAPHY_TOKENS)['size'][number];");
    expect(ts).toContain("export type LetterSpacingToken = (typeof TYPOGRAPHY_TOKENS)['letter-spacing'][number];");
  });

  it('sets tokens with references, and a mobile value in its media query', async () => {
    const { root, result } = await setTypography({ set: 'size/scale/06=1.5rem; size/heading/base={size.scale.06}; family/sans=Inter, sans-serif' });
    expect(result.issues).toEqual([]);
    expect(await typography(root, { set: 'size/heading/base=1.25rem', mode: 'mobile' })).toMatchObject({ summary: 'Typography updated: size/heading/base.' });
    expect((await json(root)).size.heading).toEqual({ base: { desktop: '{size.scale.06}', mobile: '1.25rem' } });
    const css = await read(root, cssPath);
    expect(css).toContain('  --font-sans: Inter, sans-serif;\n');
    expect(css).toContain('  --text-heading-base: var(--text-scale-06);\n');
    expect(css).toContain('@media (max-width: 767px) {\n  :root {\n    --text-heading-base: 1.25rem;\n  }\n}\n');
    expect(await read(root, tsPath)).toContain("    'heading-base',");
  });

  it('refuses unknown groups, a group without a name, and values its property can\'t take', async () => {
    const { root } = await setTypography({});
    expect(codes(await typography(root, { set: 'color/x=#fff' }))).toEqual(['font-group-unknown']);
    expect(codes(await typography(root, { set: 'size=2rem' }))).toEqual(['font-path-group']);
    expect(codes(await typography(root, { set: 'weight/heavy=450' }))).toEqual(['font-invalid']);
    expect(codes(await typography(root, { set: 'size/huge=big' }))).toEqual(['font-invalid']);
    expect((await typography(root, { set: 'line-height/loose=2' })).ok).toBe(true);
  });

  it('removes tokens, but not while a style uses them', async () => {
    const component = 'src/app/components/Card/Card.module.css';
    const { root } = await setTypography({}, { [component]: '.root {\n  font-size: var(--text-lg);\n}\n' });
    expect(codes(await typography(root, { remove: 'size/lg' }))).toEqual(['font-in-use']);
    expect((await typography(root, { remove: 'size/4xl' })).summary).toBe('Typography updated: removed size/4xl.');
    expect((await json(root)).size['4xl']).toBeUndefined();
  });

  it('moves the fonts out of an older global.css, and imports the typography after the colors', async () => {
    const old = "@import './tokens/colors.css';\n\n:root {\n  color-scheme: light dark;\n  --font-sans: 'DM Sans', sans-serif;\n  --font-mono: ui-monospace, monospace;\n}\n";
    const { root, result } = await setTypography({}, { [globalPath]: old, 'src/app/styles/tokens/colors.css': ':root {}\n' });
    expect(result.issues).toEqual([]);
    expect(await read(root, globalPath)).toBe("@import './tokens/colors.css';\n@import './tokens/typography.css';\n\n:root {\n  color-scheme: light dark;\n}\n");
    expect((await json(root)).family).toEqual({ sans: "'DM Sans', sans-serif", mono: 'ui-monospace, monospace' });

    const tailwind = '@import "tailwindcss";\n@import \'./tokens/colors.css\';\n\n@theme {\n  --font-sans: Inter, sans-serif;\n}\n\nbody {}\n';
    const moved = await setTypography({}, { [globalPath]: tailwind, 'src/app/styles/tokens/colors.css': '@theme {}\n' }, { styles: 'tailwind' });
    expect(await read(moved.root, globalPath)).toBe('@import "tailwindcss";\n@import \'./tokens/colors.css\';\n@import \'./tokens/typography.css\';\n\nbody {}\n');
  });
});

describe('check: the typography', () => {
  const issuesOf = async (root: string) => (await checkStructure(root)).issues.filter((issue) => /font|typography/.test(issue.code)).map((issue) => `${issue.code} ${issue.path}`);

  it('reports variables the styles use that are not tokens, and fonts still in global.css', async () => {
    const component = 'src/app/components/Card/Card.module.css';
    const { root } = await setTypography({}, { [component]: '.root {\n  font-family: var(--font-sans);\n  font-weight: var(--font-weight-heavy);\n  font-size: 14px;\n}\n' });
    expect(await issuesOf(root)).toEqual([`font-unknown ${component}`]);

    const old = await createProject({ [globalPath]: ':root {\n  --font-sans: Inter;\n}\n' }, { appFiles: 'app' });
    expect(await issuesOf(old)).toEqual([`typography-legacy ${globalPath}`]);
  });
});
