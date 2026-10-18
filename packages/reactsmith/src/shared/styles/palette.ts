import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig, StyleLibrary } from '../config/types.js';
import { IssueError } from '../issues.js';

/** Brand colors: each gets hover, subtle and on-* variants. */
export const BRAND_ROLES = ['primary', 'secondary'] as const;
/** Status colors, with an on-* variant for text on top of them. */
export const STATUS_ROLES = ['success', 'warning', 'danger', 'info'] as const;
/** The colors a dev can set: the neutral gives the backgrounds, borders and text. */
export const PALETTE_ROLES = [...BRAND_ROLES, 'neutral', ...STATUS_ROLES] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];
/** A role with an optional color for dark mode. The neutral has none: its dark shades are derived. */
export type ColoredRole = Exclude<PaletteRole, 'neutral'>;

export interface PaletteColor {
  light: string;
  dark?: string;
}

export type Palette = Record<PaletteRole, PaletteColor>;

export const DEFAULT_PALETTE: Palette = {
  primary: { light: '#2563eb' },
  secondary: { light: '#7c3aed' },
  neutral: { light: '#64748b' },
  success: { light: '#16a34a' },
  warning: { light: '#d97706' },
  danger: { light: '#dc2626' },
  info: { light: '#0284c7' },
};

export const PALETTE_FILE = 'palette.css';

/** Text on a color: whichever of these is more readable on it. */
const ON_LIGHT = '#ffffff';
const ON_DARK = '#111827';

function paletteError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

type Rgb = [number, number, number];

function hslToRgb(h: number, s: number, l: number): Rgb {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

/** The sRGB channels of a hex, rgb() or hsl() color, or undefined when it is not one. */
function toRgb(color: string): Rgb | undefined {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color);
  if (hex) {
    const digits = hex[1]!.length <= 4 ? [...hex[1]!.slice(0, 3)].map((d) => d + d).join('') : hex[1]!.slice(0, 6);
    return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }
  const numbers = (text: string) => text.split(/[\s,/]+/).filter(Boolean).map((part) => Number.parseFloat(part));
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(color);
  if (rgb) {
    const [r, g, b] = numbers(rgb[1]!);
    return [r, g, b].every((n) => n !== undefined && n >= 0 && n <= 255) ? ([r, g, b] as Rgb) : undefined;
  }
  const hsl = /^hsla?\(([^)]+)\)$/i.exec(color);
  if (hsl) {
    const [h, s, l] = numbers(hsl[1]!.replace(/deg|%/g, ''));
    if ([h, s, l].some((n) => n === undefined || Number.isNaN(n)) || s! > 100 || l! > 100) return undefined;
    return hslToRgb(h! % 360, s! / 100, l! / 100);
  }
  return undefined;
}

/** "#2563EB" → "#2563eb"; refuses what is not a hex, rgb() or hsl() color. */
export function parseColor(text: string, option: string): string {
  const color = text.trim();
  if (!toRgb(color)) {
    throw paletteError('color-invalid', `${option} "${text}" is not a valid color.`, 'Use a hex color ("#2563eb"), rgb(37 99 235) or hsl(221 83% 53%).');
  }
  return color.startsWith('#') ? color.toLowerCase() : color;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** The more readable text color on `color`, by WCAG contrast. */
export function onColor(color: string): string {
  const background = luminance(toRgb(color)!);
  const contrast = (text: string) => {
    const [a, b] = [background, luminance(toRgb(text)!)].sort((x, y) => y - x) as [number, number];
    return (a + 0.05) / (b + 0.05);
  };
  return contrast(ON_LIGHT) >= contrast(ON_DARK) ? ON_LIGHT : ON_DARK;
}

const lightDark = (light: string, dark?: string) => (dark && dark !== light ? `light-dark(${light}, ${dark})` : light);

/** The tokens of the palette, by group: base colors as given, everything else derived from them. */
function tokens(palette: Palette): { group: string; lines: string[] }[] {
  const colored = (role: ColoredRole, variants: boolean) => {
    const { light, dark } = palette[role];
    return [
      `--color-${role}: ${lightDark(light, dark)};`,
      ...(variants
        ? [
            `--color-${role}-hover: color-mix(in oklch, var(--color-${role}) 85%, black);`,
            `--color-${role}-subtle: color-mix(in oklch, var(--color-${role}) 12%, transparent);`,
          ]
        : []),
      `--color-on-${role}: ${lightDark(onColor(light), dark && onColor(dark))};`,
    ];
  };
  // Neutral shades: mixed with white in light mode, with black in dark mode.
  const shade = (light: number, dark: number, lightBase = 'white', darkBase = 'black') =>
    `light-dark(color-mix(in oklch, var(--color-neutral) ${light}%, ${lightBase}), color-mix(in oklch, var(--color-neutral) ${dark}%, ${darkBase}))`;
  return [
    { group: 'Brand', lines: BRAND_ROLES.flatMap((role) => colored(role, true)) },
    {
      group: 'Neutrals: backgrounds, borders and text',
      lines: [
        `--color-neutral: ${palette.neutral.light};`,
        `--color-bg: ${shade(2, 12)};`,
        `--color-surface: ${shade(6, 18)};`,
        `--color-border: ${shade(25, 40)};`,
        `--color-text: ${shade(25, 8, 'black', 'white')};`,
        `--color-text-muted: ${shade(85, 70, 'black', 'white')};`,
      ],
    },
    { group: 'Status', lines: STATUS_ROLES.flatMap((role) => colored(role, false)) },
  ];
}

/** The palette file: CSS variables for CSS Modules, theme values for Tailwind ("bg-primary", "text-on-primary"…). */
export function paletteContent(library: StyleLibrary, palette: Palette): string {
  const header = [
    '/*',
    ' * Palette, written by "reactsmith style palette". Change the base colors with the command:',
    ' * hover, subtle, on-* and the neutral shades derive from them.',
    ' */',
  ].join('\n');
  const body = tokens(palette)
    .map(({ group, lines }) => [`  /* ${group} */`, ...lines.map((line) => `  ${line}`)].join('\n'))
    .join('\n\n');
  return `${header}\n${library === 'tailwind' ? '@theme' : ':root'} {\n${body}\n}\n`;
}

/** Splits "a, b" at the top level, keeping commas inside parentheses. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  return [...parts, current.trim()];
}

/** The base colors of a palette file, falling back to the defaults for the ones it lacks or that are not plain colors. */
export function readPalette(text: string | undefined): Palette {
  const palette: Palette = structuredClone(DEFAULT_PALETTE);
  if (text === undefined) return palette;
  for (const role of PALETTE_ROLES) {
    const value = new RegExp(`^\\s*--color-${role}:\\s*(.+?);\\s*$`, 'm').exec(text)?.[1];
    if (!value) continue;
    const pair = /^light-dark\((.*)\)$/.exec(value);
    const [light, dark] = pair ? splitTopLevel(pair[1]!) : [value];
    if (light && toRgb(light)) palette[role] = { light, ...(dark && toRgb(dark) && role !== 'neutral' ? { dark } : {}) };
  }
  return palette;
}

/** Project-relative path of the palette file, next to the global styles. */
export function palettePath(config: ResolvedConfig): string | undefined {
  if (!config.folders.app || !config.appFolders.styles) return undefined;
  return `${config.srcDir}/${config.folders.app}/${config.appFolders.styles}/${PALETTE_FILE}`;
}

/** New colors for some roles: a light color, and a dark one for the roles that have it. */
export type PaletteChanges = Partial<Record<PaletteRole, Partial<PaletteColor>>>;

/**
 * Plans writing the palette with `changes` applied over the current one (or the defaults).
 * Returns the roles that changed.
 */
export async function planPalette(changes: ChangeSet, config: ResolvedConfig, updates: PaletteChanges = {}): Promise<PaletteRole[]> {
  const fileRel = palettePath(config);
  if (!fileRel) {
    throw paletteError('styles-disabled', 'The palette needs the app styles folder.', 'Set "folders.app" and "appFolders.styles" in the config.');
  }
  const current = await changes.read(fileRel);
  const palette = readPalette(current);
  const changed: PaletteRole[] = [];
  for (const role of PALETTE_ROLES) {
    const update = updates[role];
    if (!update) continue;
    const next = { light: update.light ?? palette[role].light, dark: update.dark ?? palette[role].dark };
    if (next.light !== palette[role].light || next.dark !== palette[role].dark) changed.push(role);
    palette[role] = next.dark ? next : { light: next.light };
  }

  const content = paletteContent(config.styles, palette);
  if (current === undefined) changes.write(fileRel, content, { type: 'create', message: 'palette' });
  else if (content !== current) changes.write(fileRel, content, { type: 'update', message: changed.length ? `palette: ${changed.join(', ')}` : 'palette rewritten' });
  else changes.skip(fileRel, 'palette already has these colors');
  return changed;
}
