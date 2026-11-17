import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport, addNamedImport, insertListItem } from '../code/insert.js';
import { checkInsertionTarget, checkList, insertBesideRoot, insertJsx, type InsertPosition, type ListOptions } from './position.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { availableConstants } from '../constants/files.js';
import { findComponentSource } from '../imports/lookup.js';
import { importComponentValues } from '../imports/values.js';
import { IssueError, type Issue } from '../issues.js';
import { cssValue, DEFAULT_LAYOUT, displayClass, MANAGED_STYLES, ROOT_STYLE_KEYS, stateDisplayRule, tailwindClasses, type RootStyle } from '../styles/layout.js';
import { assertInlineStyleLimit } from '../structure/inline-styles.js';
import { planComponentStyling, propsInterface } from '../styles/styleable.js';
import { assertValidJsx, packageTakesChildren } from '../types/check.js';
import { applyNames, destructureProps } from '../values/scope.js';
import { propTargets, propTypes, type PropTarget } from '../values/placeholders.js';
import { jsxText, parseValue, rootNames } from '../values/template.js';
import { TRANSLATOR_NAME } from '../config/defaults.js';
import { keyPath, messageJsx, requireMessage, requirePropMessages, translatorOf, withTranslator } from '../i18n/messages.js';
import { createContainerClassifier, declaresChildren } from '../layout/classify.js';
import { elementId, resolveTarget, type ResolvedElement } from './ids.js';
import { allNodes, buildElementTree, componentFunction, type ElementNode } from './tree.js';
import { displayState, elementKind, flexDisplay, holdsElements, holdsText, isComponentName, isHtmlTag, layoutRefusal, takesLayout } from './kinds.js';
import { tableNestingProblem } from './table.js';
import { unwrapParentheses } from './conditions.js';
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
  /** Instead of a text, a translated message of the component's group: "workshops" shows {t('workshops')}. */
  message?: string;
  /** A style name: adds `className={styles.<name>}` and its rule in the component's style file. */
  name?: string;
  /** The layout of a layout element; needs a name, which holds it. */
  style?: RootStyle;
  /** Repeats a component over a list: `{links.map((link) => <NavLink key={link.href} … />)}`. */
  list?: ListOptions;
  /** Shows the new element (or list) only when this name holds: `{open && <nav />}`; "!open" for the opposite. */
  if?: string;
  /** Shows the value of this name, or the new element when it is missing: `{label ?? <Placeholder />}`. */
  fallback?: string;
}

export interface ElementInsertResult {
  /** Project-relative path of the edited file. */
  file: string;
  /** The id of the target element. */
  target: string;
  /** The id of the inserted element, to target it next: by its name when it has one. */
  id: string;
  /** E.g. a variable that got a placeholder. */
  warnings?: Issue[];
}

function elementError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** "open", "!open", "user.isAdmin": the test of a condition, a name with an optional "!". */
const CONDITION_TEST = /^!?[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;

function checkTest(test: string, option: string, negation: boolean): void {
  if (CONDITION_TEST.test(test) && (negation || !test.startsWith('!'))) return;
  throw elementError(
    'condition-test-invalid',
    `"${test}" is not a name to test.`,
    `Pass a prop or a variable of the component${negation ? ', or "!name" for the opposite' : ''}, e.g. ${option} open. Compute anything else first, e.g. "const hasItems = items.length > 0".`,
  );
}

/** The element a node is in: its parent, looking through conditions, which are not elements. */
function containerOf(roots: ElementNode[], node: ElementNode): ElementNode | undefined {
  const parent = allNodes(roots).find((candidate) => candidate.children.includes(node));
  return parent?.kind === 'condition' ? containerOf(roots, parent) : parent;
}

/** The condition a node is a branch of, if any. */
function conditionOf(roots: ElementNode[], node: ElementNode): ElementNode | undefined {
  const parent = allNodes(roots).find((candidate) => candidate.children.includes(node));
  return parent?.kind === 'condition' ? parent : undefined;
}

/**
 * A condition with the new branch: `open && <A />` becomes `open ? <A /> : <B />`, a null branch takes it.
 * A condition with two branches, or a fallback, has no room for another one.
 */
function withBranch(condition: ElementNode, sourceFile: ts.SourceFile, branch: string, id: string, file: string): { start: number; end: number; code: string } {
  const expression = unwrapParentheses((condition.node as ts.JsxExpression).expression!);
  const { operator, test, branches } = condition.condition!;
  if (operator === '||' || operator === '??') {
    throw elementError('condition-full', `${id} is a fallback: it shows its value or one element.`, 'Insert next to it instead, or change it by hand.', file);
  }
  if (branches.length === 2) {
    throw elementError('condition-full', `${id} already shows an element in both branches.`, 'Insert into one of its elements, or next to the condition.', file);
  }
  if (operator === '&&') return { start: expression.getStart(sourceFile), end: expression.getEnd(), code: `${test} ? ${branches[0]!.node.getText(sourceFile)} : ${branch}` };
  // `open ? <A /> : null`: the null branch takes the new element.
  const ternary = expression as ts.ConditionalExpression;
  const empty = branches[0]!.branch === 'then' ? ternary.whenFalse : ternary.whenTrue;
  return { start: empty.getStart(sourceFile), end: empty.getEnd(), code: branch };
}

/**
 * Plans wrapping an element or a list in a condition: `element insert "{?open}" --around <target>` writes
 * `{open && <nav />}`. The test is a name the component knows (a prop is destructured), "!open" for the opposite.
 */
async function planConditionWrap(changes: ChangeSet, config: ResolvedConfig, options: ElementInsertOptions, test: string): Promise<ElementInsertResult> {
  const given = [
    options.text !== undefined && '--text',
    options.message !== undefined && '--message',
    options.list && '--each',
    options.from !== undefined && '--from',
    options.style && 'layout options',
    options.name !== undefined && '--name',
    options.props !== undefined && '--props',
    options.if !== undefined && '--if',
    options.fallback !== undefined && '--fallback',
    options.through !== undefined && '--through',
  ].filter(Boolean);
  if (options.position !== 'around') throw elementError('options-conflict', `"{?${test}}" is a condition: it wraps an element, with --around.`, `E.g. element insert "{?${test}}" --around <element>. To insert a new element under a condition, pass --if ${test}.`);
  if (given.length) throw elementError('options-conflict', `"{?${test}}" wraps one element in a condition: ${given.join(' and ')} ${given.length === 1 ? 'does' : 'do'} not apply.`, 'Wrap several elements in one element first, e.g. a div, then wrap that.');
  checkTest(test, '"{?…}"', true);

  const { id, file, element, tree } = await resolveTarget(changes.root, config, options.target);
  if (element.kind === 'slot' || element.kind === 'condition') {
    throw elementError('condition-wrap-invalid', `${id} is ${element.kind === 'slot' ? 'a prop' : 'a condition'}: only an element or a list goes in a condition.`, element.kind === 'condition' ? 'Combine the tests in a variable instead, e.g. "const show = open && ready".' : 'Wrap the elements inside it instead.', file);
  }
  if (!allNodes(tree.roots).some((node) => node.children.includes(element))) {
    throw elementError('wrap-root', `${id} is the root of ${tree.component}.`, 'Wrap the elements inside it instead, or the component where it is used.', file);
  }
  if (conditionOf(tree.roots, element)) {
    throw elementError('condition-nested', `${id} is already a branch of a condition, and conditions don't nest.`, 'Combine the tests in a variable instead, e.g. "const show = open && ready".', file);
  }

  const original = tree.sourceFile.getFullText();
  const node = element.node;
  const shown = element.kind === 'list' ? (node as ts.JsxExpression).expression!.getText(tree.sourceFile) : node.getText(tree.sourceFile);
  const jsx = `{${test} && ${shown}}`;
  let updated = `${original.slice(0, node.getStart(tree.sourceFile))}${jsx}${original.slice(node.getEnd())}`;
  const constants = await availableConstants(changes, config, file);
  updated = applyNames(updated, file, tree.component, [test.replace(/^!/, '').split('.')[0]!], { constants });
  changes.write(file, updated, { type: 'update', message: `put ${elementId('', element, tree)} in the condition {${test} && …}` });
  return { file, target: id, id: newElementId(changes, config, file, tree.component, updated, jsx) };
}

/** The rule of a new style: an element that holds others lays out its children, a text element starts empty for the dev. */
function styleRule(name: string, style: RootStyle | undefined, display: 'flex' | 'inline-flex', state = ''): { css: string; tailwind: string } {
  // No layout options: the default layout. Some: only those. Without a direction, a button or a link (inline-flex)
  // lays out in a row, an icon next to its label; anything else in a column.
  const direction = display === 'inline-flex' ? 'row' : DEFAULT_LAYOUT.direction;
  const given = style ? Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) : undefined;
  const layout = given ? (Object.keys(given).length ? { direction, ...given } : { ...DEFAULT_LAYOUT, direction }) : undefined;
  const declarations = layout
    ? [...(state ? [] : [`display: ${display}`]), ...ROOT_STYLE_KEYS.flatMap((key) => (cssValue(key, layout) === undefined ? [] : [`${MANAGED_STYLES[key].css}: ${cssValue(key, layout)}`]))]
    : [];
  const classes = layout ? [displayClass(display, state), ...ROOT_STYLE_KEYS.flatMap((key) => tailwindClasses(key, layout))] : [];
  return {
    css: `.${name} {\n${declarations.map((declaration) => `  ${declaration};\n`).join('')}}\n${layout ? stateDisplayRule(name, display, state) : ''}`,
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
async function planStyle(changes: ChangeSet, config: ResolvedConfig, componentRel: string, componentText: string, name: string, style: RootStyle | undefined, display: 'flex' | 'inline-flex' = 'flex', state = ''): Promise<string | undefined> {
  const base = path.posix.basename(componentRel).replace(/\.[jt]sx?$/, '');
  const fileName = `${base}${STYLE_FILE_SUFFIXES[config.styles]}`;
  const styleRel = `${path.posix.dirname(componentRel)}/${fileName}`;
  const rule = styleRule(name, style, display, state);
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
  if (parent.kind === 'condition' && through !== undefined) {
    throw elementError('wrap-not-siblings', `${id} is a branch of the condition ${elementId('', parent, tree)}: its branches show one or the other, not side by side.`, 'Wrap one branch at a time, or the whole condition.', file);
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
  const conditionTest = /^\{\?(.+)\}$/.exec(tag)?.[1];
  if (conditionTest !== undefined) return planConditionWrap(changes, config, options, conditionTest.trim());
  const around = position === 'around';
  if (options.if !== undefined && options.fallback !== undefined) throw elementError('options-conflict', '--if and --fallback cannot be used together.', '--if shows the element when a name holds; --fallback shows it when a value is missing.');
  if (around && (options.if !== undefined || options.fallback !== undefined)) {
    throw elementError('options-conflict', `${options.if !== undefined ? '--if' : '--fallback'} and --around cannot be used together.`, 'To put elements that exist in a condition, wrap them: element insert "{?open}" --around <element>.');
  }
  if (options.if !== undefined) checkTest(options.if, '--if', true);
  if (options.fallback !== undefined) checkTest(options.fallback, '--fallback', false);
  if (text !== undefined && options.message !== undefined) throw elementError('options-conflict', '--text and --message cannot be used together.', 'Pass the text one way: --message shows a translated text, --text a literal one.');
  if (around && options.message !== undefined) throw elementError('options-conflict', '--message and --around cannot be used together.', 'The new element holds the elements it wraps: give it a message with "element update" afterwards, or insert a text element.');
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
  const props = parseAttributes(options.props, tag, { messages: config.i18n !== undefined });

  const resolved = await resolveTarget(changes.root, config, options.target);
  const { id, file, tree } = resolved;
  // A message must have its text in the default language first; the translator's name comes from the component.
  if (options.message !== undefined) await requireMessage(changes, config, tree.component, options.message, file);
  await requirePropMessages(changes, config, tree.sourceFile, tree.component, props.messages, file);
  const translator = options.message !== undefined ? (translatorOf(tree.sourceFile, tree.component, config.i18n!)?.name ?? TRANSLATOR_NAME) : undefined;
  const content = options.message !== undefined ? messageJsx(translator!, keyPath(options.message).join('.')) : textParts ? jsxText(textParts) : undefined;
  const sibling = position === 'before' || position === 'after';
  // Next to a branch of a condition is next to the condition: the new element doesn't become conditional by accident.
  const element = (sibling && conditionOf(tree.roots, resolved.element)) || resolved.element;
  // Into a condition: the new element is its other branch.
  const intoCondition = !around && !sibling && element.kind === 'condition';
  if (intoCondition && (options.if !== undefined || options.fallback !== undefined)) {
    throw elementError('condition-nested', `${id} is a condition, and conditions don't nest.`, 'Combine the tests in a variable instead, e.g. "const show = open && ready".', file);
  }
  const original = tree.sourceFile.getFullText();
  const source = html ? undefined : await findComponentSource(changes, config, file, original, tag, options.from);
  const range = around ? await wrappedRange(config, changes.root, resolved, options.through) : undefined;
  if (!around && !intoCondition) checkInsertionTarget({ ...resolved, element }, position, true);
  const besideRoot = sibling && !allNodes(tree.roots).some((node) => node.children.includes(element));
  const container = range ? (range.parent.kind === 'condition' ? containerOf(tree.roots, range.parent) : range.parent) : sibling || intoCondition ? containerOf(tree.roots, element) : element;
  if (intoCondition && !container?.layout) {
    throw elementError('insert-target-not-layout', `Cannot insert into ${id}: it is in "${container?.tag ?? tree.component}", which holds no elements.`, 'Elements go into layout elements (div, nav…) and interactive ones (a, button…).', file);
  }
  // An icon of the icon library renders an svg, which a table element can't hold; other components may render a row or a cell.
  const isIcon = source?.kind === 'package' && source.from === config.icons?.library;
  const nesting = [container && tableNestingProblem(container.tag, isIcon ? '#icon' : tag), ...(range?.nodes ?? []).map((node) => tableNestingProblem(tag, node.kind === 'list' ? (node.component ?? node.tag) : node.tag))].find(Boolean);
  if (nesting) throw elementError('table-content-invalid', nesting.message, nesting.hint, file);
  const kind = elementKind(config, tag, source?.kindSource);
  if (range) {
    const componentText = source?.kind === 'project' ? ((await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '') : '';
    // A component takes children when its props say so: the project's in its file, a package's in its types (Suspense).
    const takesChildren =
      (source?.kind === 'project' && declaresChildren(componentText, tag)) || (source?.kind === 'package' && packageTakesChildren(changes.root, source.from, tag) === true);
    if (!holdsElements(kind) && !takesChildren) {
      throw elementError('wrap-not-container', `<${tag}> can't hold the elements it would wrap.`, 'Wrap them in a layout element (div, section…), an interactive one (a, button…), or a component that takes children.', file);
    }
    const [start, end] = [range.nodes[0]!.node.getStart(tree.sourceFile), range.nodes[range.nodes.length - 1]!.node.getEnd()];
    if (hasText(range.parent, range.nodes, start, end, tree.sourceFile) && !holdsText(kind)) {
      throw elementError('element-text-not-allowed', `The wrapped content has text, and <${tag}> holds none.`, 'Wrap it in a text or interactive element, or wrap only the elements next to the text.', file);
    }
  }

  if (content !== undefined && !holdsText(kind)) {
    // A component that takes children holds elements: its text goes in a text element inside it.
    const takesChildren = source?.kind === 'project' && declaresChildren((await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '', tag);
    if (takesChildren) {
      throw elementError(
        'element-text-not-allowed',
        `<${tag}> takes children, which hold elements, not text.`,
        `Insert it, then a text element into it: element insert span --into <the ${tag}> --text "…". Or, for a component that only shows text, give ${tag} a string prop shown with --text "{label}".`,
        file,
      );
    }
    throw elementError('element-text-not-allowed', `<${tag}> holds no text: only text elements (span, p…) and interactive ones (a, button…) do.`, 'Insert a text element into it, or give it its text through --props.', file);
  }
  if (style && !takesLayout(kind, tag, source?.kind === 'project' && declaresChildren((await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '', tag))) {
    const refusal = layoutRefusal(tag);
    throw elementError(refusal.code, refusal.message, refusal.hint, file);
  }
  // A component of the project is styled like any element: with a class, which it merges into its root.
  let classProp = 'className';
  let targets: Map<string, PropTarget> | undefined;
  if (source?.kind === 'project') {
    classProp = await planComponentStyling(changes, config, source.folderRel!, tag, props.attributes.map((attribute) => attribute.name), name !== undefined);
    const componentText = (await changes.read(`${source.folderRel}/${tag}.tsx`)) ?? '';
    const own = { ...props, attributes: props.attributes.filter((attribute) => attribute.name !== classProp) };
    checkDeclaredProps(own, tag, declaredProps(componentText, tag), list ? ['key'] : []);
    targets = propTargets(own, tag, propTypes(componentText, tag));
  }
  const warnings: Issue[] = [];

  const attributes = `${list ? ` key={${list.key}}` : ''}${name ? ` ${classProp}={styles.${name}}` : ''}${props.jsx}`;
  const single = content !== undefined ? `<${tag}${attributes}>${content}</${tag}>` : `<${tag}${attributes} />`;
  assertInlineStyleLimit(config, single, tag);
  let used = [...rootNames(textParts ?? []), ...props.names];
  let jsx = single;
  if (list) {
    checkList(list, tree.sourceFile, tree.component, file);
    jsx = `{${list.each}.map((${list.as}) => ${single})}`;
    // The item is defined by the list; the list itself must be a variable of the file.
    used = [list.each.split('.')[0]!, ...used.filter((usedName) => usedName !== list.as)];
  }
  // What the new branch shows, without braces: the element, or the list's `.map(…)`; how its id is found again.
  const shown = list ? jsx.slice(1, -1) : jsx;
  let marker = jsx;
  const test = options.if ?? options.fallback;
  if (test !== undefined) {
    jsx = options.if !== undefined ? `{${test} && ${shown}}` : `{${test} ?? ${shown}}`;
    marker = shown;
    used = [...used, test.replace(/^!/, '').split('.')[0]!];
  }

  let updated: string;
  if (range) {
    const [start, end] = [range.nodes[0]!.node.getStart(tree.sourceFile), range.nodes[range.nodes.length - 1]!.node.getEnd()];
    updated = wrapCode(original, start, end, `<${tag}${attributes}>`, `</${tag}>`);
    jsx = updated.slice(start, updated.length - (original.length - end));
    marker = jsx;
  } else if (intoCondition) {
    const branch = withBranch(element, tree.sourceFile, shown, id, file);
    updated = `${original.slice(0, branch.start)}${branch.code}${original.slice(branch.end)}`;
    jsx = shown;
    marker = shown;
  } else if (besideRoot) {
    updated = insertBesideRoot(original, tree.sourceFile, element, position as 'before' | 'after', jsx);
  } else {
    updated = insertJsx(original, tree.sourceFile, element, position as InsertPosition, jsx);
  }
  const constants = await availableConstants(changes, config, file);
  updated = await importComponentValues(changes, config, file, updated, tree.component, props.names, constants);
  updated = applyNames(updated, file, tree.component, [...new Set(used)], { constants, propTargets: targets, warnings });
  if (options.message !== undefined || props.messages.length) updated = withTranslator(updated, file, tree.component, config.i18n!).text;
  if (source && !source.imported) updated = addNamedImport(updated, file, tag, source.specifier);
  const styleImport = name ? await planStyle(changes, config, file, updated, name, style, flexDisplay(kind), displayState(tag)) : undefined;
  if (styleImport) updated = addImport(updated, ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), styleImport);
  // HTML and package elements have no interface of ours: TypeScript says which props they take.
  if (source?.kind === 'package' || (html && props.attributes.length > 0)) assertValidJsx(changes.root, file, updated, jsx, tag, changes.pending());

  const wrapped = range && (range.nodes.length === 1 ? elementId('', element, tree) : `${range.nodes.length} elements of ${elementId('', range.parent, tree)}`);
  const where = range
    ? `around ${wrapped}`
    : intoCondition
      ? `as the other branch of ${elementId('', element, tree)}`
      : position === 'inside'
        ? `into ${elementId('', element, tree)}`
        : position === 'first'
          ? `at the start of ${elementId('', element, tree)}`
          : `${position} ${elementId('', element, tree)}`;
  const what = `${list ? `a list of <${tag}> over ${list.each}` : `<${tag}>`}${options.if !== undefined ? ` shown when ${options.if}` : options.fallback !== undefined ? ` shown when ${options.fallback} is missing` : ''}`;
  const imported = source && !source.imported ? ` and its import from "${source.specifier}"` : '';
  changes.write(file, updated, { type: 'update', message: `inserted ${what} ${where}${imported}` });
  return { file, target: id, id: newElementId(changes, config, file, tree.component, updated, marker), warnings };
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
  const given = [options.text !== undefined && '--text', options.message !== undefined && '--message', options.list && '--each', options.from !== undefined && '--from', options.style && 'layout options', position === 'around' && '--around', options.fallback !== undefined && '--fallback'].filter(Boolean);
  if (given.length) throw elementError('options-conflict', `"{${prop}}" renders a prop: ${given.join(' and ')} ${given.length === 1 ? 'does' : 'do'} not apply.`, 'Give it --name and --props, like any element, and --if to show it only sometimes.');
  if (options.if !== undefined) checkTest(options.if, '--if', true);
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
  // An optional prop is shown only when it is given: --if icon tests the prop under its rendered name, {Icon && <Icon />}.
  const test = options.if?.replace(new RegExp(`^(!?)${prop}\\b`), `$1${alias}`);
  const code = test === undefined ? jsx : `{${test} && ${jsx}}`;
  let updated = insertJsx(sourceFile.getFullText(), sourceFile, element, position as InsertPosition, code);
  updated = renderedAs(updated, file, tree.component, prop, alias);
  const constants = await availableConstants(changes, config, file);
  updated = await importComponentValues(changes, config, file, updated, tree.component, props.names, constants);
  const testName = test?.replace(/^!/, '').split('.')[0];
  updated = applyNames(updated, file, tree.component, [...new Set([...props.names, ...(testName && testName !== alias ? [testName] : [])])], { constants });
  const styleImport = name ? await planStyle(changes, config, file, updated, name, undefined) : undefined;
  if (styleImport) updated = addImport(updated, ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), styleImport);
  if (name !== undefined || props.attributes.length > 0) assertValidJsx(changes.root, file, updated, jsx, alias, changes.pending());

  const at = elementId('', element, tree);
  const where = position === 'inside' ? `into ${at}` : position === 'first' ? `at the start of ${at}` : `${position} ${at}`;
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
