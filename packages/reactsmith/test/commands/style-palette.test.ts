import { describe, expect, it } from 'vitest';
import { stylePaletteCommand } from '../../src/commands/style/palette/command.js';
import { ChangeSet } from '../../src/shared/changes.js';
import { loadConfig } from '../../src/shared/config/load.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { DEFAULT_PALETTE, onColor, paletteContent, parseColor, readPalette } from '../../src/shared/styles/palette.js';
import { colorsIssues, parseColors, planColors, tokenPath } from '../../src/shared/tokens/colors.js';
import { createProject, exists, read } from '../helpers.js';

const legacyPath = 'src/app/styles/palette.css';
const jsonPath = 'src/app/styles/tokens/colors.json';
const cssPath = 'src/app/styles/tokens/colors.css';
const tsPath = 'src/app/styles/tokens/colors.ts';
const globalPath = 'src/app/styles/global.css';

type Options = Partial<Record<'set' | 'mode' | 'remove' | 'primary' | 'primaryDark' | 'secondary' | 'neutral' | 'danger', string>> & { force?: boolean };

function palette(root: string, options: Options) {
  return stylePaletteCommand.run({
    cwd: root,
    args: {},
    options: {
      set: options.set,
      mode: options.mode,
      remove: options.remove,
      primary: options.primary,
      primaryDark: options.primaryDark,
      secondary: options.secondary,
      secondaryDark: undefined,
      neutral: options.neutral,
      success: undefined,
      successDark: undefined,
      warning: undefined,
      warningDark: undefined,
      danger: options.danger,
      dangerDark: undefined,
      info: undefined,
      infoDark: undefined,
      force: options.force ?? false,
      dryRun: false,
    },
  });
}

async function setPalette(options: Options, tree: Record<string, string> = {}, config: object = {}) {
  const root = await createProject(tree, { appFiles: 'app', ...config });
  return { root, result: await palette(root, options) };
}

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);
const json = async (root: string) => JSON.parse(await read(root, jsonPath));

describe('colors', () => {
  it.each([
    ['#2563EB', '#2563eb'],
    ['#fff', '#fff'],
    ['rgb(37 99 235)', 'rgb(37 99 235)'],
    ['hsl(221 83% 53%)', 'hsl(221 83% 53%)'],
  ])('accepts %s', (text, color) => {
    expect(parseColor(text, '--primary')).toBe(color);
  });

  it.each(['blue', '#12345', 'rgb(300 0 0)', 'oklch(0.6 0.2 260)'])('refuses %s', (text) => {
    expect(() => parseColor(text, '--primary')).toThrow('--primary');
  });

  it('picks the more readable text color on top', () => {
    expect(onColor('#2563eb')).toBe('#ffffff');
    expect(onColor('#facc15')).toBe('#111827');
    expect(onColor('hsl(0 0% 100%)')).toBe('#111827');
  });

  it('reads back the base colors of an old palette.css, including dark ones', () => {
    const old = { ...DEFAULT_PALETTE, primary: { light: '#e11d48', dark: '#fb7185' } };
    expect(readPalette(paletteContent('css-modules', old))).toEqual(old);
  });

  it('turns Figma variable names into token paths', () => {
    expect(tokenPath('Text/Default/Secondary')).toEqual(['text', 'default', 'secondary']);
    expect(tokenPath('Background/Neutral/Tertiary Hover')).toEqual(['background', 'neutral', 'tertiary-hover']);
    expect(tokenPath('brand.800')).toEqual(['brand', '800']);
    expect(() => tokenPath('text/Ünknown')).toThrow('not a valid key');
  });

  it('finds what is wrong in a hierarchy: names taken, modes, references, loops', () => {
    const issues = colorsIssues(
      parseColors(
        JSON.stringify({
          primary: { default: '#000' },
          'primary-x': '#111',
          primary2: { x: '#222' },
          'primary2-x': '#333',
          text: { light: '#000' },
          link: { light: '#000', dark: '#fff', dim: '#888' },
          a: '{b}',
          b: 'color-mix(in oklch, {a} 50%, white)',
          c: '{nowhere}',
        }),
        jsonPath,
      ),
      jsonPath,
    );
    expect(issues.map((issue) => issue.code)).toEqual(['color-name-taken', 'color-mode-missing', 'color-mode-unknown', 'color-reference-unknown', 'color-reference-loop']);
  });
});

describe('style palette: the roles', () => {
  it('writes colors.json, the CSS variables and the token type, with the same variables as before', async () => {
    const { root, result } = await setPalette({ primary: '#e11d48', neutral: '#78716c' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Palette updated: primary, neutral.');
    const css = await read(root, cssPath);
    expect(css).toContain(':root {');
    expect(css).toContain('  --color-primary: #e11d48;\n');
    expect(css).toContain('  --color-primary-hover: color-mix(in oklch, var(--color-primary) 85%, black);\n');
    expect(css).toContain('  --color-primary-subtle: color-mix(in oklch, var(--color-primary) 12%, transparent);\n');
    expect(css).toContain('  --color-on-primary: #ffffff;\n');
    expect(css).toContain('  --color-neutral: #78716c;\n');
    expect(css).toContain('  --color-bg: light-dark(color-mix(in oklch, var(--color-neutral) 2%, white), color-mix(in oklch, var(--color-neutral) 12%, black));\n');
    expect(css).toContain('  --color-text: light-dark(color-mix(in oklch, var(--color-neutral) 25%, black), color-mix(in oklch, var(--color-neutral) 8%, white));\n');
    expect(css).toContain('  --color-text-muted: ');
    expect(css).toContain(`  --color-secondary: ${DEFAULT_PALETTE.secondary.light};\n`);
    expect(css).toContain('  --color-on-danger: #ffffff;\n');
    expect((await json(root)).primary).toEqual({ default: '#e11d48', hover: 'color-mix(in oklch, {primary} 85%, black)', subtle: 'color-mix(in oklch, {primary} 12%, transparent)' });
    const ts = await read(root, tsPath);
    expect(ts).toContain("  'primary',\n  'primary-hover',");
    expect(ts).toContain('export type ColorToken = (typeof COLOR_TOKENS)[number];');
  });

  it('changes only the given colors, keeping a dark value and the text on top in step', async () => {
    const { root } = await setPalette({ primary: '#e11d48', secondary: '#0d9488' });
    expect((await palette(root, { primaryDark: '#fb7185' })).summary).toBe('Palette updated: primary.');
    const css = await read(root, cssPath);
    expect(css).toContain('  --color-primary: light-dark(#e11d48, #fb7185);\n');
    expect(css).toContain('  --color-on-primary: light-dark(#ffffff, #111827);\n');
    expect(css).toContain('  --color-secondary: #0d9488;\n');
    await palette(root, { primary: '#be123c' });
    expect(await read(root, cssPath)).toContain('  --color-primary: light-dark(#be123c, #fb7185);\n');
  });

  it('writes theme values with Tailwind', async () => {
    const { root } = await setPalette({ primary: '#e11d48' }, {}, { styles: 'tailwind' });
    const css = await read(root, cssPath);
    expect(css).toContain('@theme {');
    expect(css).not.toContain(':root');
  });

  it('imports the colors in global styles without them, after Tailwind', async () => {
    const plain = await setPalette({ primary: '#e11d48' }, { [globalPath]: 'body {\n  margin: 0;\n}\n' });
    expect(await read(plain.root, globalPath)).toBe("@import './tokens/colors.css';\n\nbody {\n  margin: 0;\n}\n");

    const tailwind = await setPalette({ primary: '#e11d48' }, { [globalPath]: '@import "tailwindcss";\n\nbody {}\n' }, { styles: 'tailwind' });
    expect(await read(tailwind.root, globalPath)).toBe('@import "tailwindcss";\n@import \'./tokens/colors.css\';\n\nbody {}\n');
  });

  it('skips what already holds, writes the files again without options, and refuses an invalid color', async () => {
    const { root } = await setPalette({ primary: '#e11d48' });
    const same = await palette(root, { primary: '#e11d48' });
    expect(same.summary).toBe('The palette already has these colors.');

    const json = await read(root, jsonPath);
    const tree = { [jsonPath]: json.replace('"#e11d48"', '"#0f766e"') };
    const rewritten = await setPalette({}, tree);
    expect(rewritten.result.summary).toBe('Palette written from colors.json.');
    expect(await read(rewritten.root, cssPath)).toContain('  --color-primary: #0f766e;\n');

    expect(codes((await setPalette({ danger: 'red' })).result)).toEqual(['color-invalid']);
  });
});

describe('style palette: any hierarchy', () => {
  it('adds colors at any path, with references, and their CSS name and type', async () => {
    const { root, result } = await setPalette({ set: 'Brand/800=#2c2c2c; Background/Brand/Default={brand.800}; Text/Default/Secondary=#757575' });
    expect(result.issues).toEqual([]);
    expect(result.summary).toBe('Palette updated: brand/800, background/brand/default, text/default/secondary.');
    const tree = await json(root);
    expect(tree.background).toEqual({ brand: { default: '{brand.800}' } });
    expect(tree.text.default).toEqual({ default: expect.any(Object), secondary: '#757575' });
    const css = await read(root, cssPath);
    expect(css).toContain('  --color-brand-800: #2c2c2c;\n');
    expect(css).toContain('  --color-background-brand: var(--color-brand-800);\n');
    expect(css).toContain('  --color-text-default-secondary: #757575;\n');
    // text.default was a color: it became the default of a group, so --color-text stays.
    expect(css).toContain('  --color-text: light-dark(');
    expect(await read(root, tsPath)).toContain("  'text-default-secondary',");
  });

  it('sets one mode, and refuses a new color with one mode only or an unknown mode', async () => {
    const { root } = await setPalette({ set: 'link=#2563eb' });
    expect((await palette(root, { set: 'link=#93c5fd', mode: 'dark' })).summary).toBe('Palette updated: link.');
    expect((await json(root)).link).toEqual({ light: '#2563eb', dark: '#93c5fd' });
    expect(await read(root, cssPath)).toContain('  --color-link: light-dark(#2563eb, #93c5fd);\n');
    expect(codes(await palette(root, { set: 'visited=#7c3aed', mode: 'dark' }))).toEqual(['color-mode-new']);
    expect(codes(await palette(root, { set: 'link=#000', mode: 'dim' }))).toEqual(['color-mode-unknown']);
    expect(codes(await palette(root, { set: 'text=#000; nothing={missing.token}' }))).toEqual(['color-reference-unknown']);
  });

  it('writes the values of other modes under their theme', async () => {
    const tree = { [jsonPath]: JSON.stringify({ $modes: ['light', 'dark', 'contrast'], ink: { light: '#111', dark: '#eee', contrast: '#000' } }) };
    const { root, result } = await setPalette({}, tree);
    expect(result.issues).toEqual([]);
    expect(await read(root, cssPath)).toContain(':root {\n  --color-ink: light-dark(#111, #eee);\n}\n\n[data-theme="contrast"] {\n  --color-ink: #000;\n}\n');
  });

  it('removes colors and groups, but not while a style or another color uses them', async () => {
    const component = 'src/app/components/Card/Card.module.css';
    const { root } = await setPalette({ set: 'brand/800=#2c2c2c; brand/900=#1e1e1e; background/brand={brand.800}; link=#2563eb' }, { [component]: '.root {\n  color: var(--color-link);\n}\n' });
    expect(codes(await palette(root, { remove: 'link' }))).toEqual(['color-in-use']);
    const referred = await palette(root, { remove: 'brand/800' });
    expect(referred.issues?.[0]?.message).toBe('"brand/800" is still used by "background/brand".');
    expect((await palette(root, { remove: 'background; brand' })).summary).toBe('Palette updated: removed background, removed brand.');
    const tree = await json(root);
    expect(tree.background).toBeUndefined();
    expect(tree.brand).toBeUndefined();
    expect(codes(await palette(root, { remove: 'nothing' }))).toEqual(['color-missing']);
  });
});

describe('style palette: moving an old palette.css', () => {
  const oldPalette = paletteContent('css-modules', { ...DEFAULT_PALETTE, primary: { light: '#e11d48', dark: '#fb7185' } });
  const tree = { [legacyPath]: oldPalette, [globalPath]: "@import './palette.css';\n\nbody {}\n" };

  it('moves its colors to colors.json, with the same variables, and imports the new file', async () => {
    const { root, result } = await setPalette({}, tree);
    expect(result.issues).toEqual([]);
    expect(await exists(root, legacyPath)).toBe(false);
    expect((await json(root)).primary.default).toEqual({ light: '#e11d48', dark: '#fb7185' });
    expect(await read(root, globalPath)).toBe("@import './tokens/colors.css';\n\nbody {}\n");
    const css = await read(root, cssPath);
    for (const line of oldPalette.split('\n').filter((text) => text.trim().startsWith('--color-'))) expect(css).toContain(`${line}\n`);
  });

  it('refuses one changed by hand unless --force, and init keeps it', async () => {
    const edited = { ...tree, [legacyPath]: oldPalette.replace(/  --color-text: [^\n]*\n/, '  --color-text: #2b3674;\n') };
    const refused = await setPalette({ primary: '#4318ff' }, edited);
    expect(codes(refused.result)).toEqual(['palette-edited']);
    expect(await exists(refused.root, legacyPath)).toBe(true);
    expect((await setPalette({ primary: '#4318ff', force: true }, edited)).result.ok).toBe(true);

    const changes = new ChangeSet(refused.root);
    await planColors(changes, (await loadConfig(refused.root)).config!);
    expect(changes.actions).toEqual([{ type: 'skip', path: legacyPath, message: 'palette changed by hand, kept' }]);
  });
});

describe('check: the colors', () => {
  const issuesOf = async (root: string) => (await checkStructure(root)).issues.filter((issue) => /color|palette/.test(issue.code)).map((issue) => `${issue.code} ${issue.path}`);

  it('reports colors the styles use that are not tokens, generated files out of date, and an old palette', async () => {
    const component = 'src/app/components/Card/Card.module.css';
    const { root } = await setPalette({ primary: '#e11d48' }, { [component]: '.root {\n  color: var(--color-primary);\n  background: var(--color-brand, #fff);\n}\n' });
    expect(await issuesOf(root)).toEqual([`color-unknown ${component}`]);

    const manual = await createProject({ [jsonPath]: JSON.stringify({ ink: '#111' }), [cssPath]: ':root {}\n' }, { appFiles: 'app' });
    expect(await issuesOf(manual)).toEqual([`colors-stale ${cssPath}`, `colors-stale ${tsPath}`]);

    const old = await createProject({ [legacyPath]: paletteContent('css-modules', DEFAULT_PALETTE) }, { appFiles: 'app' });
    expect(await issuesOf(old)).toEqual([`palette-legacy ${legacyPath}`]);
  });
});
