import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport, addNamedImport, insertListItem } from '../code/insert.js';
import { checkInsertionTarget, checkList, insertJsx, type InsertPosition, type ListOptions } from './position.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { availableConstants } from '../constants/files.js';
import { findComponentSource } from '../imports/lookup.js';
import { importComponentValues } from '../imports/values.js';
import { IssueError } from '../issues.js';
import { cssValue, DEFAULT_LAYOUT, MANAGED_STYLES, ROOT_STYLE_KEYS, tailwindClasses, type RootStyle } from '../styles/layout.js';
import { assertInlineStyleLimit } from '../structure/inline-styles.js';
import { planComponentStyling, propsInterface } from '../styles/styleable.js';
import { assertValidJsx } from '../types/check.js';
import { applyNames, destructureProps } from '../values/scope.js';
import { jsxText, parseValue, rootNames } from '../values/template.js';
import { createContainerClassifier, declaresChildren } from '../layout/classify.js';
import { elementId, resolveTarget, type ResolvedElement } from './ids.js';
import { allNodes, buildElementTree, componentFunction, type ElementNode } from './tree.js';
import { elementKind, holdsElements, holdsText, isComponentName, isHtmlTag, takesLayout } from './kinds.js';
import { isTableElement, tableNestingProblem } from './table.js';
import { checkDeclaredProps, declaredProps, parseAttributes } from './props.js';

export interface ElementInsertOptions {
  /** What to insert: an HTML tag ("div", "img") or a component ("NavLink", "NavMenu"). */
  tag: string;
  /** An element id or "file:line[:column]". */
  target: string;
  /** Where, relative to the target; "around" wraps it (through `through`) in the new element. */
  position: InsertPosition | 'around';
  /** With "around": the last of the target's siblings to wrap, so all from the target to it go in. */
  through?: string;
  /** Where a component comes from, when its name alone is not enough: "app", a feature, "shared", or a package. */
  from?: string;
  /** Props as JSX attributes, e.g. 'to="/" end'; values are literals or variables of the file. */
  props?: string;
  /** The text of a text or interactive element; "{name}" uses a variable of the file, e.g. "{label}". */
  text?: string;
  /** A style name: adds `className={styles.<name>}` and its rule in the component's style file. */
  name?: string;
  /** The layout of a layout element; needs a name, which holds it. */
  style?: RootStyle;
  /** Repeats a component over a list: `{links.map((link) => <NavLink key={link.href} … />)}`. */
  list?: ListOptions;
}

export interface ElementInsertResult {
  /** Project-relative path of the edited file. */
  file: string;
  /** The id of the target element. */
  target: string;
  /** The id of the inserted element, to target it next: by its name when it has one. */
  id: string;
}

function elementError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The rule of a new style: a layout element lays out its children, a text element starts empty for the dev. */
function styleRule(name: string, style: RootStyle | undefined): { css: string; tailwind: string } {
  const layout = style ? { ...DEFAULT_LAYOUT, ...style } : undefined;
  const declarations = layout
    ? ['display: flex', ...ROOT_STYLE_KEYS.flatMap((key) => (cssValue(key, layout) === undefined ? [] : [`${MANAGED_STYLES[key].css}: ${cssValue(key, layout)}`]))]
    : [];
  const classes = layout ? ['flex', ...ROOT_STYLE_KEYS.flatMap((key) => tailwindClasses(key, layout))] : [];
  return {
    css: `.${name} {\n${declarations.map((declaration) => `  ${declaration};\n`).join('')}}\n`,
    tailwind: `${name}: '${classes.join(' ')}'`,
  };
}

/** The object literal of `export const styles = {…}` in a Tailwind styles file. */
function stylesObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === 'styles' && declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

/** Plans the new style in the component's style file, creating the file when it is missing. Returns its import when the component lacks it. */
async function planStyle(changes: ChangeSet, config: ResolvedConfig, componentRel: string, componentText: string, name: string, style: RootStyle | undefined): Promise<string | undefined> {
  const base = path.posix.basename(componentRel).replace(/\.[jt]sx?$/, '');
  const fileName = `${base}${STYLE_FILE_SUFFIXES[config.styles]}`;
  const styleRel = `${path.posix.dirname(componentRel)}/${fileName}`;
  const rule = styleRule(name, style);
  const text = await changes.read(styleRel);

  if (text === undefined) {
    const content = config.styles === 'tailwind' ? `export const styles = {\n  ${rule.tailwind},\n};\n` : rule.css;
    changes.write(styleRel, content, { type: 'create', message: `styles, with "${name}"` });
  } else if (config.styles === 'tailwind') {
    const sourceFile = ts.createSourceFile(styleRel, text, ts.ScriptTarget.Latest, true);
    const object = stylesObject(sourceFile);
    if (!object) throw elementError('styles-object-missing', `${styleRel} has no "export const styles = { … }".`, 'Add the styles object, which holds the classes of the component.', styleRel);
    if (object.properties.some((property) => property.name?.getText(sourceFile) === name)) {
      throw elementError('style-name-taken', `${styleRel} already has a style "${name}".`, 'Choose another --name.', styleRel);
    }
    changes.write(styleRel, insertListItem(text, sourceFile, object, [rule.tailwind]), { type: 'update', message: `added the style "${name}"` });
  } else {
    if (new RegExp(`(^|\\n)\\s*\\.${name}\\s*\\{`).test(text)) {
      throw elementError('style-name-taken', `${styleRel} already has a rule ".${name}".`, 'Choose another --name.', styleRel);
    }
    changes.write(styleRel, `${text.replace(/\s*$/, '\n')}\n${rule.css}`, { type: 'update', message: `added the rule ".${name}"` });
  }

  const imported = /^import\s+(styles|\{\s*styles\s*\})\s+from\s/m.test(componentText);
  if (imported) return undefined;
  return config.styles === 'tailwind' ? `import { styles } from './${fileName.replace(/\.ts$/, '')}'` : `import styles from './${fileName}'`;
}

/** The siblings to wrap: from the target through `through`, in the order of the code. Not the root, not props. */
async function wrappedRange(config: ResolvedConfig, root: string, resolved: ResolvedElement, through: string | undefined): Promise<{ parent: ElementNode; nodes: ElementNode[] }> {
  const { id, file, element, tree } = resolved;
  if (element.kind === 'slot') throw elementError('wrap-not-an-element', `${id} is a prop, not an element.`, 'Wrap the elements inside it instead.', file);
  const parent = allNodes(tree.roots).find((node) => node.children.includes(element));
  if (!parent) {
    throw elementError('wrap-root', `${id} is the root of ${tree.component}.`, 'Wrap the elements inside it instead: the root carries the class a parent passes to the component.', file);
  }
  const siblings = parent.children.filter((node) => node.kind !== 'slot');
  let [from, to] = [siblings.indexOf(element), siblings.indexOf(element)];
  if (through !== undefined) {
    const last = await resolveTarget(root, config, through);
    // Resolved from its own parse of the file: matched by where it starts.
    const lastStart = last.element.node.getStart(last.tree.sourceFile);
    const index = siblings.findIndex((node) => node.node.getStart(tree.sourceFile) === lastStart);
    if (last.file !== file || index === -1) {
      throw elementError('wrap-not-siblings', `${last.id} is not next to ${id}: only siblings, elements of the same parent, are wrapped together.`, `Choose an element of ${parent.path} for --through.`, file);
    }
    [from, to] = [Math.min(from, index), Math.max(from, index)];
  }
  return { parent, nodes: siblings.slice(from, to + 1) };
}

/** Whether the code between `start` and `end` in the parent shows text: words or values, not elements or lists. */
function hasText(parent: ElementNode, nodes: ElementNode[], start: number, end: number, sourceFile: ts.SourceFile): boolean {
  if (!ts.isJsxElement(parent.node)) return false;
  return parent.node.children.some((child) => {
    if (child.getStart(sourceFile) < start || child.getEnd() > end) return false;
    if (ts.isJsxText(child)) return !child.containsOnlyTriviaWhiteSpaces;
    return ts.isJsxExpression(child) && !!child.expression && !nodes.some((node) => node.node === child);
  });
}

/** `open` and `close` around the code from `start` to `end`: on their own lines, re-indented, when it starts a line. */
function wrapCode(text: string, start: number, end: number, open: string, close: string): string {
  const inner = text.slice(start, end);
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const indent = text.slice(lineStart, start);
  if (indent.trim() !== '') return `${text.slice(0, start)}${open}${inner}${close}${text.slice(end)}`;
  return `${text.slice(0, start)}${open}\n${indent}  ${inner.replace(/\n(?=[^\n])/g, '\n  ')}\n${indent}${close}${text.slice(end)}`;
}

/**
 * Plans inserting an element into a layout or interactive element of a component, a view or a layout: an HTML tag,
 * or a component of the project or of a package, imported from where it is found (or from --from). Its props are
 * checked against the component's interface, or against TypeScript's types for HTML and package elements.
 * With a name, the element gets its own style in the file's style file, which holds the layout of a layout element.
 * With a list, the component is repeated over it.
 */
export async function planElementInsert(changes: ChangeSet, config: ResolvedConfig, options: ElementInsertOptions): Promise<ElementInsertResult> {
  const { tag, name, style, text, position, list } = options;
  const prop = /^\{\s*([A-Za-z_$][\w$]*)\s*\}$/.exec(tag)?.[1];
  if (prop !== undefined) return planPropInsert(changes, config, options, prop);
  const around = position === 'around';
  if (around && text !== undefined) throw elementError('options-conflict', '--text and --around cannot be used together.', 'The new element holds the elements it wraps: give it text with "element update" afterwards, or insert a text element.');
  if (around && list) throw elementError('options-conflict', '--each and --around cannot be used together.', 'A list repeats a component with its own props: wrap the list in an element instead.');
  const html = isHtmlTag(tag);
  if (!html && !isComponentName(tag)) {
    throw elementError('element-tag-invalid', `"${tag}" is neither an HTML tag nor a component name.`, 'HTML tags are lowercase, e.g. "div"; components are PascalCase, e.g. "NavLink".');
  }
  if (html && options.from !== undefined) throw elementError('options-conflict', `"${tag}" is an HTML tag: there is nothing to import.`, 'Leave out --from.');
  if (html && list) throw elementError('list-not-component', 'Lists only repeat components.', 'Create a component for the item, e.g. with "component create", and repeat it.');
  if (style && !name) throw elementError('element-name-required', 'Layout options need a --name: the style that holds them.', 'Add e.g. --name links.');
  if (name !== undefined && (!/^[a-z][A-Za-z0-9]*$/.test(name) || name === 'root')) {
    throw elementError('element-name-invalid', `"${name}" is not a valid style name.`, 'Use a camelCase name other than "root", e.g. "brand" or "navLinks".');
  }
  const textParts = text === undefined ? undefined : parseValue(text);
  const props = parseAttributes(options.props, tag);

  const resolved = await resolveTarget(changes.root, config, options.target);
  const { id, file, element, tree } = resolved;
  const original = tree.sourceFile.getFullText();
  const source = html ? undefined : await findComponentSource(changes, config, file, original, tag, options.from);
  const range = around ? await wrappedRange(config, changes.root, resolved, options.through) : undefined;
  if (!around) checkInsertionTarget(resolved, position);
  const container = range ? range.parent : position === 'before' || position === 'after' ? allNodes(tree.roots).find((node) => node.children.includes(element)) : element;
  // An icon of the icon library renders an svg, which a table element can't hold; other components may render a row or a cell.
  const isIcon = source?.kind === 'package' && source.from === config.icons?.library;
  const nesting = [container && tableNestingProblem(container.tag, isIcon ? '#icon' : tag), ...(range?.nodes ?? []).map((node) => tableNestingProblem(tag, node.kind === 'list' ? (node.component ?? node.tag) : node.tag))].find(Boolean);
  if (nesting) throw elementError('table-content-invalid', nesting.message, nesting.hint, file);
  const kind = elementKind(config, tag, source?.kindSource);
  if (range) {
    const componentText = source?.kind === 'project' ? ((await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '') : '';
    if (!holdsElements(kind) && !(source?.kind === 'project' && declaresChildren(componentText, tag))) {
      throw elementError('wrap-not-container', `<${tag}> can't hold the elements it would wrap.`, 'Wrap them in a layout element (div, section…), an interactive one (a, button…), or a component that takes children.', file);
    }
    const [start, end] = [range.nodes[0]!.node.getStart(tree.sourceFile), range.nodes[range.nodes.length - 1]!.node.getEnd()];
    if (hasText(range.parent, range.nodes, start, end, tree.sourceFile) && !holdsText(kind)) {
      throw elementError('element-text-not-allowed', `The wrapped content has text, and <${tag}> holds none.`, 'Wrap it in a text or interactive element, or wrap only the elements next to the text.', file);
    }
  }

  if (textParts && !holdsText(kind)) {
    throw elementError('element-text-not-allowed', `<${tag}> holds no text: only text elements (span, p…) and interactive ones (a, button…) do.`, 'Insert a text element into it, or give it its text through --props.', file);
  }
  if (style && !takesLayout(kind, tag)) {
    const why = isTableElement(tag) ? `<${tag}> is laid out by its table` : `<${tag}> is not a layout element`;
    throw elementError('element-layout-not-allowed', `${why}: layout options are for layout elements.`, 'Style it in its rule in the style file instead.', file);
  }
  // A component of the project is styled like any element: with a class, which it merges into its root.
  let classProp = 'className';
  if (source?.kind === 'project') {
    classProp = await planComponentStyling(changes, config, source.folderRel!, tag, props.attributes.map((attribute) => attribute.name), name !== undefined);
    const componentText = (await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '';
    const own = { ...props, attributes: props.attributes.filter((attribute) => attribute.name !== classProp) };
    checkDeclaredProps(own, tag, declaredProps(componentText, tag), list ? ['key'] : []);
  }

  const attributes = `${list ? ` key={${list.key}}` : ''}${name ? ` ${classProp}={styles.${name}}` : ''}${props.jsx}`;
  const single = textParts ? `<${tag}${attributes}>${jsxText(textParts)}</${tag}>` : `<${tag}${attributes} />`;
  assertInlineStyleLimit(config, single, tag);
  let used = [...rootNames(textParts ?? []), ...props.names];
  let jsx = single;
  if (list) {
    checkList(list, tree.sourceFile, tree.component, file);
    jsx = `{${list.each}.map((${list.as}) => ${single})}`;
    // The item is defined by the list; the list itself must be a variable of the file.
    used = [list.each.split('.')[0]!, ...used.filter((usedName) => usedName !== list.as)];
  }

  let updated: string;
  if (range) {
    const [start, end] = [range.nodes[0]!.node.getStart(tree.sourceFile), range.nodes[range.nodes.length - 1]!.node.getEnd()];
    updated = wrapCode(original, start, end, `<${tag}${attributes}>`, `</${tag}>`);
    jsx = updated.slice(start, updated.length - (original.length - end));
  } else {
    updated = insertJsx(original, tree.sourceFile, element, position as InsertPosition, jsx);
  }
  const constants = await availableConstants(changes, config, file);
  updated = await importComponentValues(changes, config, file, updated, tree.component, props.names, constants);
  updated = applyNames(updated, file, tree.component, [...new Set(used)], { constants });
  if (source && !source.imported) updated = addNamedImport(updated, file, tag, source.specifier);
  const styleImport = name ? await planStyle(changes, config, file, updated, name, style) : undefined;
  if (styleImport) updated = addImport(updated, ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), styleImport);
  // HTML and package elements have no interface of ours: TypeScript says which props they take.
  if (source?.kind === 'package' || (html && props.attributes.length > 0)) assertValidJsx(changes.root, file, updated, jsx, tag);

  const wrapped = range && (range.nodes.length === 1 ? element.path : `${range.nodes.length} elements of ${range.parent.path}`);
  const where = range ? `around ${wrapped}` : position === 'inside' ? `into ${element.path}` : position === 'first' ? `at the start of ${element.path}` : `${position} ${element.path}`;
  const what = list ? `a list of <${tag}> over ${list.each}` : `<${tag}>`;
  const imported = source && !source.imported ? ` and its import from "${source.specifier}"` : '';
  changes.write(file, updated, { type: 'update', message: `inserted ${what} ${where}${imported}` });
  return { file, target: id, id: newElementId(changes, config, file, tree.component, updated, jsx) };
}

/** Types that hold a component to render: React's component types, and the icon type of the icon library. */
function isComponentType(type: string, sourceFile: ts.SourceFile, iconLibrary: string | undefined): boolean {
  if (/^(React\.)?(ComponentType|FC|FunctionComponent|ComponentClass|ElementType|ExoticComponent)\b/.test(type)) return true;
  const name = /^[A-Z][\w$]*$/.exec(type)?.[0];
  if (!name) return false;
  // A type imported from the icon library, such as lucide-react's LucideIcon.
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === iconLibrary &&
      !!statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === name),
  );
}

/**
 * Plans rendering a prop of the component that holds a component, `icon: LucideIcon`: `element insert "{icon}"`
 * writes `<Icon />`, the prop destructured as `icon: Icon`, and the element takes a name and props like any other.
 */
async function planPropInsert(changes: ChangeSet, config: ResolvedConfig, options: ElementInsertOptions, prop: string): Promise<ElementInsertResult> {
  const { name, position } = options;
  const given = [options.text !== undefined && '--text', options.list && '--each', options.from !== undefined && '--from', options.style && 'layout options', position === 'around' && '--around'].filter(Boolean);
  if (given.length) throw elementError('options-conflict', `"{${prop}}" renders a prop: ${given.join(' and ')} ${given.length === 1 ? 'does' : 'do'} not apply.`, 'Give it --name and --props, like any element.');
  if (name !== undefined && (!/^[a-z][A-Za-z0-9]*$/.test(name) || name === 'root')) {
    throw elementError('element-name-invalid', `"${name}" is not a valid style name.`, 'Use a camelCase name other than "root", e.g. "icon".');
  }
  const resolved = await resolveTarget(changes.root, config, options.target);
  const { id, file, element, tree } = resolved;
  checkInsertionTarget(resolved, position as InsertPosition);
  const sourceFile = tree.sourceFile;

  const member = propsInterface(sourceFile, tree.component)?.members.find((candidate) => candidate.name?.getText(sourceFile) === prop);
  if (!member || !ts.isPropertySignature(member)) {
    throw elementError('prop-unknown', `${tree.component} has no prop "${prop}".`, `Add it first, e.g. "component update ${tree.component} --interface \\"${prop}: LucideIcon\\"".`, file);
  }
  const type = (member.type?.getText(sourceFile) ?? '').split('|').map((part) => part.trim()).filter((part) => part !== 'undefined' && part !== 'null').join(' | ');
  if (/^(React\.)?(ReactNode|ReactElement\b|JSX\.Element)|^React\.JSX\.Element/.test(type)) {
    throw elementError('prop-render-node', `"${prop}" is a ${type}: rendering an element passed as a value isn't supported yet.`, `Type it as a component instead (e.g. "${prop}: LucideIcon"), so the component renders it, or write {${prop}} by hand.`, file);
  }
  if (!isComponentType(type, sourceFile, config.icons?.library)) {
    throw elementError('prop-not-component', `"${prop}" is a ${type || 'value'}, not a component to render.`, `Show text in a text element: "element insert span --text \\"{${prop}}\\"".`, file);
  }

  // JSX renders a component from a capitalized name: the prop is destructured as `icon: Icon`.
  const alias = `${prop[0]!.toUpperCase()}${prop.slice(1)}`;
  const props = parseAttributes(options.props, alias);
  const attributes = `${name ? ` className={styles.${name}}` : ''}${props.jsx}`;
  const jsx = `<${alias}${attributes} />`;
  assertInlineStyleLimit(config, jsx, alias);
  let updated = insertJsx(sourceFile.getFullText(), sourceFile, element, position as InsertPosition, jsx);
  updated = renderedAs(updated, file, tree.component, prop, alias);
  const constants = await availableConstants(changes, config, file);
  updated = await importComponentValues(changes, config, file, updated, tree.component, props.names, constants);
  updated = applyNames(updated, file, tree.component, [...new Set(props.names)], { constants });
  const styleImport = name ? await planStyle(changes, config, file, updated, name, undefined) : undefined;
  if (styleImport) updated = addImport(updated, ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), styleImport);
  if (name !== undefined || props.attributes.length > 0) assertValidJsx(changes.root, file, updated, jsx, alias);

  const where = position === 'inside' ? `into ${element.path}` : position === 'first' ? `at the start of ${element.path}` : `${position} ${element.path}`;
  changes.write(file, updated, { type: 'update', message: `rendered the prop "${prop}" as <${alias}> ${where}` });
  return { file, target: id, id: newElementId(changes, config, file, tree.component, updated, jsx) };
}

/** Destructures `prop` as `alias` in the component's parameter: `({ icon })` becomes `({ icon: Icon })`. */
function renderedAs(text: string, file: string, component: string, prop: string, alias: string): string {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = componentFunction(sourceFile, component);
  const parameter = fn?.parameters[0];
  if (parameter && !ts.isObjectBindingPattern(parameter.name)) {
    throw elementError('props-not-destructured', `${component} takes its props as "${parameter.name.getText(sourceFile)}", not destructured.`, `Destructure them by hand, e.g. ({ ${prop}: ${alias} }), then insert it.`, file);
  }
  const binding = parameter && (parameter.name as ts.ObjectBindingPattern).elements.find((candidate) => (candidate.propertyName ?? candidate.name).getText(sourceFile) === prop);
  if (binding?.propertyName) {
    if (binding.name.getText(sourceFile) !== alias) {
      throw elementError('prop-renamed', `${component} destructures "${prop}" as "${binding.name.getText(sourceFile)}".`, `Rename it to ${alias} by hand: JSX renders a component from a capitalized name.`, file);
    }
    return text;
  }
  if (binding) return `${text.slice(0, binding.getStart(sourceFile))}${prop}: ${alias}${text.slice(binding.getEnd())}`;
  return destructureProps(text, file, component, [`${prop}: ${alias}`]);
}

/** The id of an element just written into a file, found by where its JSX starts in the updated code. */
function newElementId(changes: ChangeSet, config: ResolvedConfig, fileRel: string, component: string, text: string, jsx: string): string {
  const srcRel = fileRel.slice(config.srcDir.length + 1);
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tree = buildElementTree(sourceFile, component, createContainerClassifier(sourceFile, changes.resolve(fileRel), changes.root, config));
  const start = text.indexOf(jsx);
  const node = tree && allNodes(tree.roots).find((candidate) => candidate.node.getStart(sourceFile) === start);
  return tree && node ? elementId(srcRel, node, tree) : '';
}
