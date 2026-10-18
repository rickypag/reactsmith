import { describe, expect, it } from 'vitest';
import { stylePaletteCommand } from '../../src/commands/style/palette/command.js';
import { DEFAULT_PALETTE, onColor, paletteContent, parseColor, readPalette } from '../../src/shared/styles/palette.js';
import { createProject, read } from '../helpers.js';

const palettePath = 'src/app/styles/palette.css';
const globalPath = 'src/app/styles/global.css';

type Colors = Partial<Record<'primary' | 'primaryDark' | 'secondary' | 'neutral' | 'danger', string>>;

async function setPalette(colors: Colors, tree: Record<string, string> = {}, config: object = {}) {
  const root = await createProject(tree, { appFiles: 'app', ...config });
  const result = await stylePaletteCommand.run({
    cwd: root,
    args: {},
    options: {
      primary: colors.primary,
      primaryDark: colors.primaryDark,
      secondary: colors.secondary,
      secondaryDark: undefined,
      neutral: colors.neutral,
      success: undefined,
      successDark: undefined,
      warning: undefined,
      warningDark: undefined,
      danger: colors.danger,
      dangerDark: undefined,
      info: undefined,
      infoDark: undefined,
      dryRun: false,
    },
  });
  return { root, result };
}

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

  it('reads back the base colors it writes, including dark ones', () => {
    const palette = { ...DEFAULT_PALETTE, primary: { light: '#e11d48', dark: '#fb7185' } };
    expect(readPalette(paletteContent('css-modules', palette))).toEqual(palette);
    expect(readPalette(paletteContent('tailwind', palette))).toEqual(palette);
  });
});

describe('style palette', () => {
  it('writes the palette from the given colors, deriving the rest', async () => {
    const { root, result } = await setPalette({ primary: '#e11d48', neutral: '#78716c' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Palette updated: primary, neutral.');
    const css = await read(root, palettePath);
    expect(css).toContain(':root {');
    expect(css).toContain('  --color-primary: #e11d48;\n');
    expect(css).toContain('  --color-primary-hover: color-mix(in oklch, var(--color-primary) 85%, black);\n');
    expect(css).toContain('  --color-primary-subtle: color-mix(in oklch, var(--color-primary) 12%, transparent);\n');
    expect(css).toContain('  --color-on-primary: #ffffff;\n');
    expect(css).toContain('  --color-neutral: #78716c;\n');
    expect(css).toContain('  --color-bg: light-dark(color-mix(in oklch, var(--color-neutral) 2%, white), color-mix(in oklch, var(--color-neutral) 12%, black));\n');
    expect(css).toContain(`  --color-secondary: ${DEFAULT_PALETTE.secondary.light};\n`);
    expect(css).toContain('  --color-on-danger: #ffffff;\n');
  });

  it('changes only the given colors and keeps the others', async () => {
    const first = await setPalette({ primary: '#e11d48', secondary: '#0d9488' });
    const again = await stylePaletteCommand.run({
      cwd: first.root,
      args: {},
      options: { primary: undefined, primaryDark: '#fb7185', secondary: undefined, secondaryDark: undefined, neutral: undefined, success: undefined, successDark: undefined, warning: undefined, warningDark: undefined, danger: undefined, dangerDark: undefined, info: undefined, infoDark: undefined, dryRun: false },
    });
    expect(again.summary).toBe('Palette updated: primary.');
    const css = await read(first.root, palettePath);
    expect(css).toContain('  --color-primary: light-dark(#e11d48, #fb7185);\n');
    expect(css).toContain('  --color-on-primary: light-dark(#ffffff, #111827);\n');
    expect(css).toContain('  --color-secondary: #0d9488;\n');
  });

  it('writes theme values with Tailwind', async () => {
    const { root } = await setPalette({ primary: '#e11d48' }, {}, { styles: 'tailwind' });
    const css = await read(root, palettePath);
    expect(css).toContain('@theme {');
    expect(css).not.toContain(':root');
  });

  it('adds the import to global styles without it, after Tailwind', async () => {
    const plain = await setPalette({ primary: '#e11d48' }, { [globalPath]: 'body {\n  margin: 0;\n}\n' });
    expect(await read(plain.root, globalPath)).toBe("@import './palette.css';\n\nbody {\n  margin: 0;\n}\n");

    const tailwind = await setPalette({ primary: '#e11d48' }, { [globalPath]: '@import "tailwindcss";\n\nbody {}\n' }, { styles: 'tailwind' });
    expect(await read(tailwind.root, globalPath)).toBe('@import "tailwindcss";\n@import \'./palette.css\';\n\nbody {}\n');
  });

  it('skips when nothing changes, and refuses no color or an invalid one', async () => {
    const { root } = await setPalette({ primary: '#e11d48' });
    const same = await stylePaletteCommand.run({
      cwd: root,
      args: {},
      options: { primary: '#e11d48', primaryDark: undefined, secondary: undefined, secondaryDark: undefined, neutral: undefined, success: undefined, successDark: undefined, warning: undefined, warningDark: undefined, danger: undefined, dangerDark: undefined, info: undefined, infoDark: undefined, dryRun: false },
    });
    expect(same.summary).toBe('The palette already has these colors.');
    expect(same.actions).toEqual([{ type: 'skip', path: palettePath, message: 'palette already has these colors' }]);

    expect((await setPalette({})).result.issues?.map((issue) => issue.code)).toEqual(['palette-nothing']);
    expect((await setPalette({ danger: 'red' })).result.issues?.map((issue) => issue.code)).toEqual(['color-invalid']);
  });
});
