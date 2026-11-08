import type { RuleExample } from '../types.js';

/**
 * Every code the rule reports for the colors, which the examples show. The typography, spacing and radius report the
 * same problems with their own prefix (font-…, space-…, radius-…).
 */
export const codes = [
  'colors-invalid',
  'color-value-invalid',
  'color-mode-missing',
  'color-reference-unknown',
  'color-reference-loop',
  'color-name-taken',
  'colors-stale',
  'palette-legacy',
] as const;

const config = { appFiles: 'app' };
const json = 'src/app/styles/tokens/colors.json';

/** A colors.json with the default modes and `tokens`. */
const colors = (tokens: Record<string, unknown>) => JSON.stringify({ $modes: ['light', 'dark'], ...tokens }, null, 2);

export const examples: RuleExample[] = [
  {
    title: 'A project without tokens yet',
    config,
    tree: { 'src/app/App.tsx': '' },
    issues: [],
  },
  {
    title: 'A colors file that is not valid JSON',
    config,
    tree: { [json]: '{ "text": ' },
    issues: [`error colors-invalid ${json}`],
  },
  {
    title: 'A color that is not a color',
    config,
    tree: { [json]: colors({ text: '#zzz' }) },
    issues: [`error color-value-invalid ${json}`],
  },
  {
    title: 'A color without a value for every mode',
    config,
    tree: { [json]: colors({ text: { light: '#111111' } }) },
    issues: [`error color-mode-missing ${json}`],
  },
  {
    title: 'A reference to a color that does not exist',
    config,
    tree: { [json]: colors({ text: '{ink}' }) },
    issues: [`error color-reference-unknown ${json}`],
  },
  {
    title: 'Colors referring to each other in a loop',
    config,
    tree: { [json]: colors({ text: '{ink}', ink: '{text}' }) },
    issues: [`error color-reference-loop ${json}`],
  },
  {
    title: 'Two colors with the same variable',
    config,
    tree: { [json]: colors({ text: { muted: '#666666' }, 'text-muted': '#777777' }) },
    issues: [`error color-name-taken ${json}`],
  },
  {
    title: 'CSS and TypeScript not written from the colors file',
    config,
    tree: { [json]: colors({ text: '#111111' }) },
    issues: ['error colors-stale src/app/styles/tokens/colors.css', 'error colors-stale src/app/styles/tokens/colors.ts'],
  },
  {
    title: 'Colors still in the old palette file',
    config,
    tree: { 'src/app/styles/palette.css': ':root {\n  --color-text: #111111;\n}\n' },
    issues: ['warning palette-legacy src/app/styles/palette.css'],
  },
];
