import type { OptionSpec, OptionSpecs } from '../core/command.js';
import { INSERT_POSITIONS } from './elements/position.js';
import { ALIGNS, DIRECTIONS, JUSTIFIES } from './styles/layout.js';

/*
 * Options that mean the same thing in every command that takes them, defined once: a command uses these, never
 * its own option of the same name (a test checks it). Only a variant for updating differs: it also takes "none".
 */

export const DRY_RUN = { type: 'boolean', description: 'Show what would change without writing anything' } as const satisfies OptionSpec;

/** The layout of an element that holds others, as new elements and components get it. */
export const LAYOUT = {
  direction: { type: 'string', values: DIRECTIONS, description: 'How it lays out its children: in a row or a column' },
  gap: { type: 'string', placeholder: 'step', description: 'Space between its children, in steps of 0.25rem: 2 is 8px' },
  align: { type: 'string', values: ALIGNS, description: 'Alignment of its children across the direction' },
  justify: { type: 'string', values: JUSTIFIES, description: 'Distribution of its children along the direction' },
  padding: { type: 'string', placeholder: 'steps', description: 'Space inside it: one step for all sides ("4"), or vertical and horizontal ("2 4")' },
} as const satisfies OptionSpecs;

/** The same layout options for updating a style: "none" removes one. */
export const LAYOUT_UPDATE = {
  direction: { ...LAYOUT.direction, values: [...DIRECTIONS, 'none'], description: `${LAYOUT.direction.description}, or "none"` },
  gap: { ...LAYOUT.gap, description: `${LAYOUT.gap.description}, or "none"` },
  align: { ...LAYOUT.align, values: [...ALIGNS, 'none'], description: `${LAYOUT.align.description}, or "none"` },
  justify: { ...LAYOUT.justify, values: [...JUSTIFIES, 'none'], description: `${LAYOUT.justify.description}, or "none"` },
  padding: { ...LAYOUT.padding, description: `${LAYOUT.padding.description}, or "none"` },
} as const satisfies OptionSpecs;

export const STYLE_NAME = {
  type: 'string',
  placeholder: 'style',
  description: 'The style of the element, e.g. "brand": its class (className={styles.brand}), its rule in the style file, and its id',
} as const satisfies OptionSpec;

export const TEXT = {
  type: 'string',
  placeholder: 'text',
  description: 'The text of a text or interactive element; "{label}" shows a prop, constant or import, e.g. "Hello, {user.name}!"',
} as const satisfies OptionSpec;

export const PROPS = {
  type: 'string',
  placeholder: 'props',
  description: 'Props as JSX attributes, e.g. \'to="/docs"\' or "to={href}", each replacing the one of the same name: values are literals or variables of the file',
} as const satisfies OptionSpec;

export const FROM = {
  type: 'string',
  placeholder: 'source',
  description: 'Where a component comes from, when its name is not enough: "app", a feature, "shared", or a package',
} as const satisfies OptionSpec;

export const INTERFACE = {
  type: 'string',
  placeholder: 'members',
  description: 'Props of the component, as TypeScript interface members, e.g. "label: string; size?: \'sm\' | \'lg\' = \'md\'" (an optional prop takes a default after "="); an update adds them or changes those that exist, creating the interface if the component has none',
} as const satisfies OptionSpec;

export const IF = {
  type: 'string',
  placeholder: 'name',
  description: 'Show it only when a prop or variable holds, e.g. --if open ({open && …}), or --if "!open" for the opposite',
} as const satisfies OptionSpec;

export const FALLBACK = {
  type: 'string',
  placeholder: 'name',
  description: 'Show the value of a prop or variable, and this element when it is missing, e.g. --fallback label ({label ?? …})',
} as const satisfies OptionSpec;

/** Where an element goes, relative to the target of --into. */
export const INTO = { type: 'string', placeholder: 'target', description: 'Where: an element id, or "path/to/File.tsx:line[:column]"' } as const satisfies OptionSpec;

export const INTO_REQUIRED = { ...INTO, required: true } as const satisfies OptionSpec;

export const POSITION = {
  type: 'string',
  values: INSERT_POSITIONS,
  description: 'Last child of --into (inside, the default), first child, or a sibling before or after it',
} as const satisfies OptionSpec;

export const THROUGH = {
  type: 'string',
  placeholder: 'target',
  description: 'The last of a run of siblings: from the target (or the --around element) through this one, in the order of the code',
} as const satisfies OptionSpec;

export const APP = { type: 'boolean', description: 'It belongs to the app, not to a feature: e.g. parts of the layout, or data the whole app uses' } as const satisfies OptionSpec;

export const FEATURE = { type: 'string', placeholder: 'name', description: 'The feature it belongs to' } as const satisfies OptionSpec;

export const FEATURE_REQUIRED = { ...FEATURE, required: true } as const satisfies OptionSpec;

export const COMPONENT = { type: 'string', placeholder: 'folder', description: 'In the constants of one component, e.g. app/components/Sidebar' } as const satisfies OptionSpec;

export const VALUE = { type: 'string', placeholder: 'json', description: 'The value as JSON, e.g. 20, \'"Docs"\' or \'[{"label":"Home","href":"/"}]\'' } as const satisfies OptionSpec;

export const VALUE_TYPE = { type: 'string', placeholder: 'type', description: 'The TypeScript type of the value, e.g. "Plan[]" (a type of the types/ folders, not the props of a component), imported from where it is found; the value is checked against it' } as const satisfies OptionSpec;

export const VALUE_FILE = { type: 'string', placeholder: 'path', description: 'A JSON file with the value, e.g. navigation.json' } as const satisfies OptionSpec;

export const ROUTE_PATH = {
  type: 'string',
  placeholder: 'path',
  description: 'The route path: of a view inside its feature, e.g. "settings", ":id", or "*" for the pages no other route matches; of a feature, its base path, or "/" for the root (default: asked, or the name)',
} as const satisfies OptionSpec;

/**
 * Every shared option by name, with the definitions a command may use for it. An option with one of these
 * names means this, in every command.
 */
export const SHARED_OPTIONS: Readonly<Record<string, readonly OptionSpec[]>> = {
  'dry-run': [DRY_RUN],
  into: [INTO, INTO_REQUIRED],
  position: [POSITION],
  through: [THROUGH],
  direction: [LAYOUT.direction, LAYOUT_UPDATE.direction],
  gap: [LAYOUT.gap, LAYOUT_UPDATE.gap],
  align: [LAYOUT.align, LAYOUT_UPDATE.align],
  justify: [LAYOUT.justify, LAYOUT_UPDATE.justify],
  padding: [LAYOUT.padding, LAYOUT_UPDATE.padding],
  name: [STYLE_NAME],
  text: [TEXT],
  props: [PROPS],
  from: [FROM],
  interface: [INTERFACE],
  if: [IF],
  fallback: [FALLBACK],
  app: [APP],
  feature: [FEATURE, FEATURE_REQUIRED],
  component: [COMPONENT],
  value: [VALUE],
  file: [VALUE_FILE],
  path: [ROUTE_PATH],
};
