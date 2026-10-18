import { stat } from 'node:fs/promises';
import type { ChangeSet } from '../changes.js';
import { HTML_SOURCE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError, type Issue } from '../issues.js';
import { DEFAULT_LAYOUT, rootStyleFile, type ExtraStyles, type FlexLayout } from '../styles/layout.js';
import { renderTemplate } from '../templates/render.js';
import { jsxText } from '../elements/insert.js';
import { parseProps } from './props.js';
import { componentScope, type ComponentOwner } from './scope.js';

export interface ComponentCreateOptions {
  owner: ComponentOwner;
  /** PascalCase component name: "Sidebar". */
  name: string;
  /** Props as interface members: "items: NavItem[]; collapsed?: boolean". */
  props?: string;
  /** How the root lays out its children. Defaults to a column with a gap of 2. */
  layout?: FlexLayout;
  /** A semantic HTML element for the root, e.g. "header", used when it is a configured layout element. */
  rootTag?: string;
  /**
   * The root element, as asked by the dev: a layout element ("nav"), or a text element ("button")
   * when the component is just that element. Unlike rootTag, it is required to be allowed.
   */
  root?: string;
  /** The text of a text element root: <button>Read the docs</button>. */
  text?: string;
  /** More root styles, such as the size and border of a layout part. */
  extraStyles?: ExtraStyles;
}

function createError(code: string, message: string, hint: string, path?: string): IssueError {
  return new IssueError({ severity: 'error', code, path, message, hint });
}

/**
 * The element a new component renders: a layout component, so other components can be inserted
 * into it later. A plain div when allowed, otherwise the first configured layout component.
 */
export function rootLayoutElement(config: ResolvedConfig, preferred?: string): { tag: string; import?: string } {
  const html = config.layoutComponents[HTML_SOURCE] ?? [];
  if (preferred && html.includes(preferred)) return { tag: preferred };
  if (html.includes('div')) return { tag: 'div' };
  for (const [source, names] of Object.entries(config.layoutComponents)) {
    if (source !== HTML_SOURCE && names[0]) return { tag: names[0], import: `import { ${names[0]} } from '${source}';` };
  }
  return { tag: html[0]! };
}

/**
 * The root of a new component, and whether it holds text instead of other elements:
 * the asked --root, checked against the layout and text elements, or a layout element.
 */
function componentRoot(config: ResolvedConfig, options: ComponentCreateOptions): { root: { tag: string; import?: string }; holdsText: boolean } {
  const layoutTags = config.layoutComponents[HTML_SOURCE] ?? [];
  const textTags = config.textComponents[HTML_SOURCE] ?? [];
  if (options.root !== undefined && !layoutTags.includes(options.root) && !textTags.includes(options.root)) {
    throw createError('root-tag-not-allowed', `"${options.root}" is neither a layout nor a text element.`, `Layout: ${layoutTags.join(', ')}. Text: ${textTags.join(', ')}.`);
  }
  const holdsText = options.root !== undefined && textTags.includes(options.root);
  if (options.text !== undefined && !holdsText) {
    throw createError('root-text-not-allowed', '--text needs a text element as --root, e.g. --root button.', 'A layout root holds elements: insert a text element into it with "element insert".');
  }
  if (holdsText && options.layout) {
    throw createError('root-layout-not-allowed', `<${options.root}> holds text, so it has no layout options.`, 'Style it in the .root rule of its style file instead.');
  }
  return { root: options.root !== undefined ? { tag: options.root } : rootLayoutElement(config, options.rootTag), holdsText };
}

/**
 * Plans a component of a feature or of the app: `<components>/<Name>/<Name>.tsx`, its style file, its `index.ts`
 * and, when the props use types that are not built in, `types.ts` with placeholders for them, so the result
 * always compiles. Returns a warning about the placeholders. Everything is checked before anything is planned.
 */
export async function planComponentCreate(changes: ChangeSet, config: ResolvedConfig, options: ComponentCreateOptions): Promise<Issue[]> {
  const { owner, name } = options;
  const scope = componentScope(config, owner);
  const dirRel = `${scope.componentsRel}/${name}`;

  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw createError('component-name-invalid', `"${name}" is not a valid component name.`, 'Use a PascalCase name like "Sidebar" or "UserCard".');
  }
  if ('feature' in owner && !(await stat(changes.resolve(scope.scopeRel)).catch(() => undefined))) {
    throw createError('feature-missing', `Feature "${owner.feature}" does not exist.`, `Create it first with "feature create ${owner.feature}".`, scope.scopeRel);
  }
  if ((await stat(changes.resolve(dirRel)).catch(() => undefined)) || (await changes.read(`${dirRel}/${name}.tsx`)) !== undefined) {
    throw createError('component-exists', `Component "${name}" already exists in ${scope.label}.`, 'Choose another name.', dirRel);
  }
  const props = options.props?.trim() ? parseProps(options.props) : undefined;
  const unknownTypes = props?.unknownTypes ?? [];
  const { root, holdsText } = componentRoot(config, options);
  const style = rootStyleFile(config.styles, name, holdsText ? undefined : (options.layout ?? DEFAULT_LAYOUT), options.extraStyles);

  const imports = [
    ...(root.import ? [root.import] : []),
    ...(unknownTypes.length ? [`import type { ${unknownTypes.join(', ')} } from './types';`] : []),
    style.importStatement,
  ];
  const values = {
    name,
    imports: imports.length ? `${imports.join('\n')}\n\n` : '',
    propsInterface: props ? `export interface ${name}Props {\n${props.members.map((member) => `  ${member};\n`).join('')}}\n\n` : '',
    propsType: props ? `<${name}Props>` : '',
    propsExport: props ? `export type { ${name}Props } from './${name}';\n` : '',
    rootElement:
      options.text === undefined ? `<${root.tag} className={styles.root} />` : `<${root.tag} className={styles.root}>${jsxText(options.text)}</${root.tag}>`,
  };

  changes.write(`${dirRel}/${name}.tsx`, await renderTemplate('component/Component.tsx', values), { type: 'create', message: 'component' });
  changes.write(`${dirRel}/${style.fileName}`, style.content, { type: 'create', message: 'styles' });
  changes.write(`${dirRel}/index.ts`, await renderTemplate('component/index.ts', values), { type: 'create', message: 'component entry point' });
  if (unknownTypes.length === 0) return [];

  const placeholders = unknownTypes.map((type) => `export type ${type} = unknown;`).join('\n');
  changes.write(`${dirRel}/types.ts`, await renderTemplate('component/types.ts', { placeholders }), { type: 'create', message: 'placeholder types' });
  const list = unknownTypes.map((type) => `"${type}"`).join(', ');
  const one = unknownTypes.length === 1;
  return [
    {
      severity: 'warning',
      code: 'type-placeholder',
      path: `${dirRel}/types.ts`,
      message: `${list} ${one ? 'is a placeholder' : 'are placeholders'} (unknown) so the component compiles.`,
      hint: `Define ${one ? 'it' : 'them'} in types.ts, or import the real type in ${name}.tsx and delete the placeholder.`,
    },
  ];
}
