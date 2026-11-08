import { stat } from 'node:fs/promises';
import type { ChangeSet } from '../changes.js';
import { HTML_SOURCE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { availableConstants } from '../constants/files.js';
import { isTableElement } from '../elements/table.js';
import { displayState, elementKind, flexDisplay, holdsElements, holdsText, isComponentName, isHtmlTag, layoutRefusal, takesLayout, type ElementKind } from '../elements/kinds.js';
import { checkDeclaredProps, declaredProps, parseAttributes } from '../elements/props.js';
import { findComponentSource, findTypeSources, type ComponentSource } from '../imports/lookup.js';
import { typeImports } from '../imports/types.js';
import { importComponentValues } from '../imports/values.js';
import { IssueError, type Issue } from '../issues.js';
import { DEFAULT_LAYOUT, rootStyleFile, type ExtraStyles, type FlexLayout } from '../styles/layout.js';
import { renderTemplate } from '../templates/render.js';
import { assertInlineStyleLimit } from '../structure/inline-styles.js';
import { planComponentStyling } from '../styles/styleable.js';
import { assertValidJsx } from '../types/check.js';
import { applyNames } from '../values/scope.js';
import { propTargets, propTypes, type PropTarget } from '../values/placeholders.js';
import { planBarrelExports } from '../code/barrel.js';
import { dependencies } from '../imports/lookup.js';
import { moduleExports } from '../types/check.js';
import { projectComponents } from './registry.js';
import { jsxText, parseValue, rootNames } from '../values/template.js';
import { interfaceMember, parseProps } from './props.js';
import { declaresChildren } from '../layout/classify.js';
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

/** Checks what the root may hold against the options: text for text and interactive roots, layout options for roots that hold elements. */
function checkRoot(tag: string, kind: ElementKind, options: ComponentCreateOptions, takesChildren: boolean): void {
  if (options.text !== undefined && !holdsText(kind)) {
    throw createError('root-text-not-allowed', `<${tag}> holds no text: --text needs a text or interactive root, e.g. --root button.`, 'A layout root holds elements: insert a text element into it with "element insert".');
  }
  if (options.layout && !takesLayout(kind, tag, takesChildren)) {
    const refusal = layoutRefusal(tag);
    throw createError(refusal.code, refusal.message, refusal.hint);
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
  // One name, one component: a name the project imports always means a single component.
  const taken = (await projectComponents(changes.root, config)).find((component) => component.name === name);
  if (taken) {
    throw createError('component-name-taken', `"${name}" already exists in ${taken.folderRel}.`, 'Component names are unique in the project: choose another name, e.g. one that says where it is used.', taken.folderRel);
  }
  const parsedInterface = options.interface?.trim() ? parseProps(options.interface) : undefined;
  // Children are always optional: a wrapper is inserted empty first, then filled one element at a time.
  const declared = parsedInterface && { ...parsedInterface, members: parsedInterface.members.map((member) => member.replace(/^children\s*:/, 'children?:')) };
  // Types an installed package exports are imported from it ("LucideIcon" from lucide-react); the others get placeholders.
  const fileRel = `${dirRel}/${name}.tsx`;
  // Types are imported from where they are found, as components are: the project's components and types/, then packages.
  const typeSources = await findTypeSources(changes, config, fileRel, '', declared?.unknownTypes ?? []);
  const unknownTypes = (declared?.unknownTypes ?? []).filter((type) => !typeSources.found.has(type));
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
  const rootTakesChildren = rootSource?.kind === 'project' && declaresChildren((await changes.read(`${rootSource.folderRel}/${root.tag}.tsx`)) ?? '', root.tag);
  checkRoot(root.tag, kind, options, rootTakesChildren);
  // A component whose props declare children holds elements: it renders them in its root, like a layout element.
  const hasChildren = declared?.names.includes('children') ?? false;
  if (hasChildren && textParts) {
    throw createError('options-conflict', '--text and children cannot be used together.', 'A component with children holds elements: its text goes in a text element inside it, or in a prop such as label.');
  }
  if (hasChildren && !holdsElements(kind)) {
    throw createError(
      'root-children-not-allowed',
      `<${root.tag}> holds no elements, so it can't render children.`,
      holdsText(kind)
        ? `To show text, declare a string prop and show it in the root instead: --interface "label: string" --root ${root.tag} --text "{label}". To hold elements, use a layout root (the default div, or e.g. --root section) or an interactive one (button, a…).`
        : 'Use a layout root (the default div, or e.g. --root section), or an interactive one (button, a…).',
    );
  }
  const rootProps = parseAttributes(options.props, root.tag);
  let targets: Map<string, PropTarget> | undefined;
  if (rootSource?.kind === 'project') {
    // The root's style comes from this component's style file: the root component must take a class.
    const classProp = await planComponentStyling(changes, config, rootSource.folderRel!, root.tag, rootProps.attributes.map((attribute) => attribute.name), true);
    const own = { ...rootProps, attributes: rootProps.attributes.filter((attribute) => attribute.name !== classProp) };
    const rootText = (await changes.read(`${rootSource.folderRel}/${root.tag}.tsx`)) ?? '';
    checkDeclaredProps(own, root.tag, declaredProps(rootText, root.tag), [], '--root-props');
    targets = propTargets(own, root.tag, propTypes(rootText, root.tag));
  }
  const warnings: Issue[] = [];
  // A layout root lays out its children by default; any other root only with layout options. Without a direction, a
  // button or a link lays out in a row (an icon next to its label), anything else in a column.
  const given = options.layout && { ...options.layout, direction: options.layout.direction ?? (kind === 'interactive' ? 'row' : DEFAULT_LAYOUT.direction) };
  const layout = kind === 'layout' && !isTableElement(root.tag) ? (given ?? DEFAULT_LAYOUT) : given;
  const style = rootStyleFile(config.styles, name, layout, options.extraStyles, flexDisplay(kind), displayState(root.tag));

  const imports = [
    ...(root.import ? [root.import] : []),
    ...typeImports(typeSources.found),
    ...(unknownTypes.length ? [`import type { ${unknownTypes.join(', ')} } from './types';`] : []),
    style.importStatement,
  ];
  const rootOpening = `<${root.tag} className={styles.root}${rootProps.jsx}`;
  const values = {
    name,
    imports: imports.length ? `${imports.join('\n')}\n\n` : '',
    propsInterface: declared ? `export interface ${name}Props {\n${declared.members.map((member, index) => `${interfaceMember(member, declared.defaults[declared.names[index]!])}\n`).join('')}}\n\n` : '',
    propsType: declared ? `<${name}Props>` : '',
    propsExport: declared ? `export type { ${name}Props } from './${name}';\n` : '',
    rootElement: hasChildren
      ? `${rootOpening}>{children}</${root.tag}>`
      : textParts === undefined
        ? `${rootOpening} />`
        : `${rootOpening}>${jsxText(textParts)}</${root.tag}>`,
  };

  assertInlineStyleLimit(config, values.rootElement, root.tag);
  const used = [...new Set([...rootNames(textParts ?? []), ...rootProps.names, ...(hasChildren ? ['children'] : [])])];
  const constants = await availableConstants(changes, config, fileRel);
  const rendered = await importComponentValues(changes, config, fileRel, await renderTemplate('component/Component.tsx', values), name, rootProps.names, constants);
  const componentText = applyNames(rendered, fileRel, name, used, {
    constants,
    propTargets: targets,
    warnings,
    hint: 'Declare it with --interface, e.g. --interface "label: string", or create it with "constant create".',
  });
  // HTML and package roots have no interface of ours: TypeScript says which props they take.
  if (rootSource?.kind === 'package' || (rootSource === undefined && rootProps.attributes.length > 0)) {
    assertValidJsx(changes.root, fileRel, componentText, values.rootElement, root.tag);
  }
  changes.write(fileRel, componentText, { type: 'create', message: 'component' });
  changes.write(`${dirRel}/${style.fileName}`, style.content, { type: 'create', message: 'styles' });
  changes.write(`${dirRel}/index.ts`, await renderTemplate('component/index.ts', values), { type: 'create', message: 'component entry point' });
  // A shared component is offered by the barrel of its type: import { PrimaryButton } from '@/components/buttons'.
  if ('type' in owner) {
    await planBarrelExports(changes, `${scope.componentsRel}/index.ts`, [`export { ${name} } from './${name}';`, ...(declared ? [`export type { ${name}Props } from './${name}';` ] : [])]);
  }

  const packages = (await dependencies(changes)).filter((dependency) => dependency !== config.icons?.library);
  const clashes = packages.length ? [...moduleExports(changes.root, packages)].filter(([, exported]) => exported?.has(name)).map(([pkg]) => pkg) : [];
  if (clashes.length) {
    warnings.push({
      severity: 'warning',
      code: 'component-name-in-dependency',
      path: fileRel,
      message: `"${name}" is also exported by ${clashes.join(', ')}.`,
      hint: `Where both can be imported, "element insert ${name}" needs --from to choose; a more specific name avoids it.`,
    });
  }
  if (unknownTypes.length === 0) return warnings;

  const placeholders = unknownTypes.map((type) => `export type ${type} = unknown;`).join('\n');
  changes.write(`${dirRel}/types.ts`, await renderTemplate('component/types.ts', { placeholders }), { type: 'create', message: 'placeholder types' });
  const list = unknownTypes.map((type) => `"${type}"`).join(', ');
  const one = unknownTypes.length === 1;
  const ambiguous = [...typeSources.ambiguous].map(([type, specifiers]) => ` "${type}" is in ${specifiers.join(' and ')}: import the one you mean.`).join('');
  return [
    ...warnings,
    {
      severity: 'warning',
      code: 'type-placeholder',
      path: `${dirRel}/types.ts`,
      message: `${list} ${one ? 'is a placeholder' : 'are placeholders'} (unknown) so the component compiles.`,
      hint: `Define ${one ? 'it' : 'them'} in types.ts, or import the real type in ${name}.tsx and delete the placeholder.${ambiguous}`,
    },
  ];
}
