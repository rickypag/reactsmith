import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { StyleLibrary } from '../config/types.js';
import { IssueError } from '../issues.js';
import { SPACE_STEPS } from './global.js';

export const DIRECTIONS = ['row', 'column'] as const;
export const ALIGNS = ['start', 'center', 'end', 'stretch'] as const;
export const JUSTIFIES = ['start', 'center', 'end', 'between'] as const;

/** Padding in spacing steps: one value for all sides, or vertical and horizontal, as in CSS. */
export type Padding = [number] | [number, number];

/** The layout of a component's root element: the styles ReactSmith writes and updates. */
export interface RootStyle {
  direction?: (typeof DIRECTIONS)[number];
  /** A step of the spacing scale: 1 step is 0.25rem, so 2 is 0.5rem (8px). */
  gap?: number;
  align?: (typeof ALIGNS)[number];
  justify?: (typeof JUSTIFIES)[number];
  padding?: Padding;
}

export type RootStyleKey = keyof RootStyle;

/** The root style of a new component. */
export interface FlexLayout extends RootStyle {
  direction: (typeof DIRECTIONS)[number];
  gap: number;
}

export const DEFAULT_LAYOUT: FlexLayout = { direction: 'column', gap: 2 };

const CSS_VALUES = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', between: 'space-between' } as const;

/** For each managed style: its CSS property, and the Tailwind classes that set it. */
export const MANAGED_STYLES: Readonly<Record<RootStyleKey, { css: string; tailwind: RegExp }>> = {
  direction: { css: 'flex-direction', tailwind: /^flex-(row|col)$/ },
  gap: { css: 'gap', tailwind: /^gap-/ },
  align: { css: 'align-items', tailwind: /^items-/ },
  justify: { css: 'justify-content', tailwind: /^justify-/ },
  padding: { css: 'padding', tailwind: /^p[xy]?-/ },
};

/** The order styles are written in. */
export const ROOT_STYLE_KEYS: readonly RootStyleKey[] = ['direction', 'gap', 'align', 'justify', 'padding'];

const STEP = /^\d+(\.5)?$/;

function invalid(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

/** "2" → 2. Steps are whole or half numbers, as in Tailwind ("gap-2", "gap-1.5"). */
export function parseGap(text: string): number {
  if (!STEP.test(text.trim())) {
    throw invalid('gap-invalid', `"${text}" is not a valid gap.`, 'Use a step of the spacing scale, e.g. 2 (0.5rem, 8px) or 1.5. 1 step is 0.25rem.');
  }
  return Number(text);
}

/** "4" → [4], "2 4" or "2,4" → [2, 4] (vertical, horizontal). */
export function parsePadding(text: string): Padding {
  const parts = text.trim().split(/[\s,]+/);
  if (parts.length > 2 || !parts.every((part) => STEP.test(part))) {
    throw invalid('padding-invalid', `"${text}" is not a valid padding.`, 'Use one spacing step for all sides ("4"), or vertical and horizontal ("2 4"). 1 step is 0.25rem.');
  }
  return parts.map(Number) as Padding;
}

/** A spacing step as CSS: its token from the global styles when it has one ("var(--space-2)"), otherwise rem. */
export function spaceValue(step: number): string {
  if (step === 0) return '0';
  return (SPACE_STEPS as readonly number[]).includes(step) ? `var(--space-${step})` : `${step * 0.25}rem`;
}

/** The CSS value of a managed style: "column", "var(--space-2)", "space-between", "0 var(--space-4)". */
export function cssValue(key: RootStyleKey, style: RootStyle): string | undefined {
  switch (key) {
    case 'direction':
      return style.direction;
    case 'gap':
      return style.gap === undefined ? undefined : spaceValue(style.gap);
    case 'align':
      return style.align && CSS_VALUES[style.align];
    case 'justify':
      return style.justify && CSS_VALUES[style.justify];
    case 'padding':
      return style.padding?.map(spaceValue).join(' ');
  }
}

/** The Tailwind classes of a managed style: ["flex-col"], ["gap-2"], ["py-0", "px-4"]. */
export function tailwindClasses(key: RootStyleKey, style: RootStyle): string[] {
  switch (key) {
    case 'direction':
      return style.direction ? [style.direction === 'row' ? 'flex-row' : 'flex-col'] : [];
    case 'gap':
      return style.gap === undefined ? [] : [`gap-${style.gap}`];
    case 'align':
      return style.align ? [`items-${style.align}`] : [];
    case 'justify':
      return style.justify ? [`justify-${style.justify}`] : [];
    case 'padding':
      if (!style.padding) return [];
      return style.padding.length === 1 ? [`p-${style.padding[0]}`] : [`py-${style.padding[0]}`, `px-${style.padding[1]}`];
  }
}

export interface StyleFile {
  /** "Sidebar.module.css" or "Sidebar.styles.ts". */
  fileName: string;
  content: string;
  /** How the component imports it, giving `styles.root`. */
  importStatement: string;
}

/** More styles for the root, beyond the managed ones, in both formats: e.g. the size and border of a top bar. */
export interface ExtraStyles {
  /** CSS declarations without the semicolon: "height: 3.5rem". */
  css: string[];
  /** The same as Tailwind classes: "h-14". */
  tailwind: string[];
}

/**
 * The style file of the component file `name`, with a `root` style laying out its children.
 * Without a layout (a root that holds text, such as a button), the root style starts empty. An interactive root
 * lays out its children as `inline-flex`, so it stays inline.
 */
export function rootStyleFile(library: StyleLibrary, name: string, layout: RootStyle | undefined, extra?: ExtraStyles, display: 'flex' | 'inline-flex' = 'flex'): StyleFile {
  const fileName = `${name}${STYLE_FILE_SUFFIXES[library]}`;
  if (library === 'tailwind') {
    const classes = [...(layout ? [display, ...ROOT_STYLE_KEYS.flatMap((key) => tailwindClasses(key, layout))] : []), ...(extra?.tailwind ?? [])];
    return {
      fileName,
      content: `export const styles = {\n  root: '${classes.join(' ')}',\n};\n`,
      importStatement: `import { styles } from './${fileName.replace(/\.ts$/, '')}';`,
    };
  }

  const declarations = [
    ...(layout
      ? [
          `display: ${display}`,
          ...ROOT_STYLE_KEYS.flatMap((key) => {
            const value = cssValue(key, layout);
            return value === undefined ? [] : [`${MANAGED_STYLES[key].css}: ${value}`];
          }),
        ]
      : []),
    ...(extra?.css ?? []),
  ];
  return {
    fileName,
    content: `.root {\n${declarations.map((declaration) => `  ${declaration};\n`).join('')}}\n`,
    importStatement: `import styles from './${fileName}';`,
  };
}
