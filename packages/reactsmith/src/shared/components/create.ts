import { stat } from 'node:fs/promises';
import type { ChangeSet } from '../changes.js';
import { HTML_SOURCE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { availableConstants } from '../constants/files.js';
import { elementKind, holdsText, isComponentName, isHtmlTag, type ElementKind } from '../elements/kinds.js';
import { checkDeclaredProps, declaredProps, parseAttributes } from '../elements/props.js';
import { findComponentSource, type ComponentSource } from '../imports/lookup.js';
import { IssueError, type Issue } from '../issues.js';
import { DEFAULT_LAYOUT, rootStyleFile, type ExtraStyles, type FlexLayout } from '../styles/layout.js';
import { renderTemplate } from '../templates/render.js';
import { assertInlineStyleLimit } from '../structure/inline-styles.js';
import { planComponentStyling } from '../styles/styleable.js';
import { assertValidJsx } from '../types/check.js';
import { applyNames } from '../values/scope.js';
import { jsxText, parseValue, rootNames } from '../values/template.js';
import { parseProps } from './props.js';
import { componentScope, type ComponentOwner } from './scope.js';

export interface ComponentCreateOptions {
  owner: ComponentOwner;
  /** PascalCase component name: "Sidebar". */
  name: string;
  /** The component's own props, as interface members: "items: NavItem[]; collapsed?: boolean". */
  interface?: string;
  /** Props of the root element, as JSX attributes: 'to={href}'. */
  props?: string;
  /** How the root lays out its children. Defaults to a column with a gap of 2. */
  layout?: FlexLayout;
  /** A semantic HTML element for the root, e.g. "header", used when it is a configured layout element. */
  rootTag?: string;
  /**
   * The root element, as asked by the dev: any HTML element ("nav", "button", "img") or component ("NavLink").
   * Its kind decides what it holds: a layout root lays out elements, a text or interactive root holds text.
   */
  root?: string;
  /** Where a component root comes from, when its name is not enough: "app", a feature, "shared", or a package. */
  from?: string;
  /** The text of a text or interactive root: <button>Read the docs</button>; "{label}" shows the prop "label". */
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

/** Checks what the root may hold against the options: text for text and interactive roots, layout options for layout roots. */
function checkRoot(tag: string, kind: ElementKind, options: ComponentCreateOptions): void {
  if (options.text !== undefined && !holdsText(kind)) {
    throw createError('root-text-not-allowed', `<${tag}> holds no text: --text needs a text or interactive root, e.g. --root button.`, 'A layout root holds elements: insert a text element into it with "element insert".');
  }
  if (options.layout && kind !== 'layout') {
    throw createError('root-layout-not-allowed', `<${tag}> is not a layout element, so it has no layout options.`, 'Style it in the .root rule of its style file instead.');
  }
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
  const declared = options.interface?.trim() ? parseProps(options.interface) : undefined;
  const unknownTypes = declared?.unknownTypes ?? [];
  const fileRel = `${dirRel}/${name}.tsx`;
  const textParts = options.text === undefined ? undefined : parseValue(options.text);

  // The root: a layout element by default, or any HTML element or component.
  let root: { tag: string; import?: string } = rootLayoutElement(config, options.rootTag);
  let kind: ElementKind = 'layout';
  let rootSource: ComponentSource | undefined;
  if (options.root !== undefined) {
    const tag = options.root;
    if (!isHtmlTag(tag) && !isComponentName(tag)) {
      throw createError('root-tag-invalid', `"${tag}" is neither an HTML tag nor a component name.`, 'HTML tags are lowercase, e.g. "nav"; components are PascalCase, e.g. "NavLink".');
    }
    if (isHtmlTag(tag) && options.from !== undefined) throw createError('options-conflict', `"${tag}" is an HTML tag: there is nothing to import.`, 'Leave out --from.');
    rootSource = isHtmlTag(tag) ? undefined : await findComponentSource(changes, config, fileRel, '', tag, options.from);
    root = rootSource ? { tag, import: `import { ${tag} } from '${rootSource.specifier}';` } : { tag };
    kind = elementKind(config, tag, rootSource?.kindSource);
  }
  checkRoot(root.tag, kind, options);
  const rootProps = parseAttributes(options.props, root.tag);
  if (rootSource?.kind === 'project') {
    // The root's style comes from this component's style file: the root component must take a class.
    const classProp = await planComponentStyling(changes, config, rootSource.folderRel!, root.tag, rootProps.attributes.map((attribute) => attribute.name), true);
    const own = { ...rootProps, attributes: rootProps.attributes.filter((attribute) => attribute.name !== classProp) };
    checkDeclaredProps(own, root.tag, declaredProps((await changes.read(`${rootSource.folderRel}/${root.tag}.tsx`)) ?? '', root.tag));
  }
  const style = rootStyleFile(config.styles, name, kind === 'layout' ? (options.layout ?? DEFAULT_LAYOUT) : undefined, options.extraStyles);

  const imports = [
    ...(root.import ? [root.import] : []),
    ...(unknownTypes.length ? [`import type { ${unknownTypes.join(', ')} } from './types';`] : []),
    style.importStatement,
  ];
  const rootOpening = `<${root.tag} className={styles.root}${rootProps.jsx}`;
  const values = {
    name,
    imports: imports.length ? `${imports.join('\n')}\n\n` : '',
    propsInterface: declared ? `export interface ${name}Props {\n${declared.members.map((member) => `  ${member};\n`).join('')}}\n\n` : '',
    propsType: declared ? `<${name}Props>` : '',
    propsExport: declared ? `export type { ${name}Props } from './${name}';\n` : '',
    rootElement: textParts === undefined ? `${rootOpening} />` : `${rootOpening}>${jsxText(textParts)}</${root.tag}>`,
  };

  assertInlineStyleLimit(config, values.rootElement, root.tag);
  const used = [...new Set([...rootNames(textParts ?? []), ...rootProps.names])];
  const componentText = applyNames(await renderTemplate('component/Component.tsx', values), fileRel, name, used, {
    constants: await availableConstants(changes, config, fileRel),
    hint: 'Declare it with --interface, e.g. --interface "label: string", or create it with "constant create".',
  });
  // HTML and package roots have no interface of ours: TypeScript says which props they take.
  if (rootSource?.kind === 'package' || (rootSource === undefined && rootProps.attributes.length > 0)) {
    assertValidJsx(changes.root, fileRel, componentText, values.rootElement, root.tag);
  }
  changes.write(fileRel, componentText, { type: 'create', message: 'component' });
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
