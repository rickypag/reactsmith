import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport, insertListItem } from '../code/insert.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { resolveTarget, type ResolvedElement } from '../elements/ids.js';
import type { ElementNode } from '../elements/tree.js';
import { applyNames } from '../values/scope.js';
import { IssueError } from '../issues.js';
import { isComponentName } from '../elements/kinds.js';
import { findComponentSource } from '../imports/lookup.js';
import { planComponentStyling, propsInterface } from './styleable.js';
import { arbitraryProperty, stateSelector, tailwindClassesFor, type Declaration, type StyleInput, type StyleState } from './declarations.js';
import { cssValue, MANAGED_STYLES, ROOT_STYLE_KEYS, tailwindClasses, type RootStyle, type RootStyleKey } from './layout.js';
import { isTableElement } from '../elements/table.js';

/** New layout values: a value sets it, null removes it, a missing key keeps it. */
export type LayoutChanges = { [K in RootStyleKey]?: RootStyle[K] | null };

export interface StyleUpdateOptions {
  /** An element id or "file:line[:column]". */
  target: string;
  /** The style to give an element that has none: adds className={styles.<name>}. */
  name?: string;
  /** The state the declarations apply to; nested states in the input go to their own state. */
  state?: StyleState;
  layout?: LayoutChanges;
  /** Declarations from CSS or a style object. */
  input?: StyleInput;
  /** Tailwind classes that replace the style's classes. */
  classes?: string;
  /** A prop of the component the style depends on: "selected" (a boolean) or "status=Error" (a value). */
  when?: string;
}

/** A condition on a prop, as the root shows it: data-selected="true". */
interface Condition {
  /** The style of the component's root, which carries the attribute. */
  rootStyle: string;
  attribute: string;
  value: string;
  /** Whether the target is the root itself. */
  self: boolean;
}

/** The selector of a style under a condition: `.root[data-selected="true"]`, or `.root[data-selected="true"] .label` for a child. */
function conditionSelector(name: string, condition: Condition | undefined): string {
  if (!condition) return `.${name}`;
  const attribute = `[${condition.attribute}="${condition.value}"]`;
  return condition.self ? `.${name}${attribute}` : `.${condition.rootStyle}${attribute} .${name}`;
}

export interface StyleUpdateResult {
  /** The style name: "root", "brand"… */
  style: string;
  /** Project-relative path of the style file. */
  file: string;
}

function styleError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The styles that set the layout of the children: setting one needs "display: flex". */
const FLEX_KEYS: readonly RootStyleKey[] = ['direction', 'gap', 'align', 'justify'];

/** The declarations to write for the base style: managed layout first, then the given ones. */
function baseDeclarations(layout: LayoutChanges, given: Declaration[]): { set: Declaration[]; removed: string[] } {
  const set: Declaration[] = [];
  const removed: string[] = [];
  for (const key of ROOT_STYLE_KEYS) {
    if (!(key in layout)) continue;
    const value = layout[key] === null ? undefined : cssValue(key, layout as RootStyle);
    if (value === undefined) removed.push(MANAGED_STYLES[key].css);
    else set.push([MANAGED_STYLES[key].css, value]);
  }
  return { set: [...set, ...given], removed };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sets and removes declarations in the rule for `selector`, creating the rule after `after` (or at the end) when missing. */
function updateRule(text: string, selector: string, set: Declaration[], removed: string[], addFlex: boolean, after: RegExp): string {
  const rule = new RegExp(`(^|\\n)(${escapeRegExp(selector)}\\s*\\{)([^}]*)\\}`).exec(text);
  if (!rule) {
    if (set.length === 0) return text;
    const declarations = [...(addFlex && !set.some(([p]) => p === 'display') ? [['display', 'flex'] as Declaration] : []), ...set];
    const block = `${selector} {\n${declarations.map(([property, value]) => `  ${property}: ${value};\n`).join('')}}\n`;
    // After the element's other rules, so its base and states stay together.
    let end = -1;
    for (const match of text.matchAll(new RegExp(after.source, 'g'))) {
      const close = text.indexOf('}', match.index);
      if (close !== -1) end = close + 1;
    }
    if (!text.trim()) return block;
    if (end === -1) return `${text.replace(/\s*$/, '\n')}\n${block}`;
    return `${text.slice(0, end)}\n\n${block.replace(/\n$/, '')}${text.slice(end)}`;
  }

  const bodyStart = rule.index + rule[1]!.length + rule[2]!.length;
  let lines = rule[3]!.split('\n');
  const indent = /^([ \t]+)\S/m.exec(rule[3]!)?.[1] ?? '  ';
  const lastDeclaration = () => lines.reduce((last, line, index) => (line.trim() ? index : last), 0);
  const declarationOf = (property: string) => lines.findIndex((line) => new RegExp(`^\\s*${escapeRegExp(property)}\\s*:`).test(line));

  for (const property of removed) lines = lines.filter((_, index) => index !== declarationOf(property));
  if (addFlex && declarationOf('display') === -1) lines.splice(lines[0]?.trim() ? 0 : 1, 0, `${indent}display: flex;`);
  for (const [property, value] of set) {
    const at = declarationOf(property);
    const line = `${indent}${property}: ${value};`;
    if (at !== -1) lines[at] = line;
    else lines.splice(lastDeclaration() + 1, 0, line);
  }

  let body = lines.join('\n');
  if (!body.startsWith('\n')) body = `\n${body}`;
  if (!body.endsWith('\n')) body = `${body}\n`;
  return text.slice(0, bodyStart) + body + text.slice(bodyStart + rule[3]!.length);
}

/** Updates the style in a CSS module: the base rule ".name" and a rule per state (".name:hover"). */
function updateCss(text: string, name: string, options: StyleUpdateOptions, condition?: Condition): string {
  const own = new RegExp(`(^|\\n)\\.${escapeRegExp(name)}(:[\\w-]+)?\\s*\\{`);
  const layout = options.layout ?? {};
  const given = options.input?.base ?? [];
  const addFlex = FLEX_KEYS.some((key) => layout[key] !== undefined && layout[key] !== null);
  const selector = conditionSelector(name, condition);

  if (options.state) {
    const states = { ...(options.input?.states ?? {}), [options.state]: [...(options.input?.states[options.state] ?? []), ...given] };
    return Object.entries(states).reduce((updated, [state, declarations]) => updateRule(updated, `${selector}${stateSelector(state as StyleState)}`, declarations ?? [], [], false, own), text);
  }
  const base = baseDeclarations(layout, given);
  let updated = updateRule(text, selector, base.set, base.removed, addFlex, own);
  for (const [state, declarations] of Object.entries(options.input?.states ?? {})) {
    updated = updateRule(updated, `${selector}${stateSelector(state as StyleState)}`, declarations ?? [], [], false, own);
  }
  return updated;
}

/** "isOpen" → "data-is-open". */
const dataAttribute = (prop: string) => `data-${prop.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

/**
 * The condition of --when, checked against the component: the prop must be one of its props, a boolean unless a value
 * is given, and the root must be an element that shows it as an attribute (not a component of the project, which
 * wouldn't pass it on). Returns the edit that adds the attribute to the root when it doesn't have it yet.
 */
function planCondition(when: string, tree: ResolvedElement['tree'], element: ElementNode, file: string): { condition: Omit<Condition, 'rootStyle'> & { rootStyle?: string }; edit?: [number, string]; prop: string } {
  const match = /^([A-Za-z_$][\w$]*)(?:=(.+))?$/.exec(when);
  if (!match || /["'[\]]/.test(match[2] ?? '')) {
    throw styleError('when-invalid', `"${when}" is not a condition.`, 'Use a prop of the component: --when selected (a boolean), or --when status=Error (a value).', file);
  }
  const [, prop, value] = match as unknown as [string, string, string | undefined];
  const sourceFile = tree.sourceFile;
  const declaration = propsInterface(sourceFile, tree.component)?.members.find((member) => member.name?.getText(sourceFile) === prop);
  if (!declaration) {
    throw styleError('when-prop-unknown', `${tree.component} has no prop "${prop}".`, `Add it first: "component update ${tree.component} --interface \\"${prop}?: boolean\\"".`, file);
  }
  const type = ts.isPropertySignature(declaration) ? (declaration.type?.getText(sourceFile) ?? '') : '';
  if (value === undefined && type !== 'boolean') {
    throw styleError('when-value-required', `"${prop}" is ${type ? `a ${type}` : 'not a boolean'}: say which value the style is for.`, `E.g. --when ${prop}=<value>.`, file);
  }
  const root = tree.roots.length === 1 ? tree.roots[0]! : undefined;
  if (!root || root.kind !== 'element') throw styleError('when-root-missing', `${tree.component} has no single root element to carry "${prop}".`, 'Style it by hand.', file);
  if (isComponentName(root.tag) && isProjectComponent(sourceFile, root.tag)) {
    throw styleError('when-root-component', `The root of ${tree.component} is <${root.tag}>, a component of the project, which would not pass "${dataAttribute(prop)}" on.`, `Style it from inside ${root.tag}, or by hand.`, file);
  }
  const attribute = dataAttribute(prop);
  const opening = ts.isJsxElement(root.node) ? root.node.openingElement : (root.node as ts.JsxSelfClosingElement);
  const existing = opening.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === attribute);
  const last = opening.attributes.properties[opening.attributes.properties.length - 1];
  const edit: [number, string] | undefined = existing ? undefined : [last ? last.getEnd() : opening.tagName.getEnd(), ` ${attribute}={${prop}}`];
  return { condition: { rootStyle: root.name, attribute, value: value ?? 'true', self: root === element }, edit, prop };
}

/** Whether a component of the file is imported from the project (a relative or alias path), not from a package. */
function isProjectComponent(sourceFile: ts.SourceFile, name: string): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /^(\.|@\/)/.test(statement.moduleSpecifier.text) &&
      !!statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings) &&
      statement.importClause.namedBindings.elements.some((element) => element.name.text === name),
  );
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

/** Updates the style's classes in a Tailwind styles object: replaced by --class, or merged property by property. */
function updateTailwind(text: string, name: string, options: StyleUpdateOptions, fileRel: string): string {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true);
  const object = stylesObject(sourceFile);
  if (!object) throw styleError('styles-object-missing', `${fileRel} has no "export const styles = { … }".`, 'Add the styles object, which holds the classes of the component.', fileRel);
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment => ts.isPropertyAssignment(candidate) && candidate.name.getText(sourceFile) === name,
  );
  const literal = property && ts.isStringLiteralLike(property.initializer) ? property.initializer : undefined;
  if (property && !literal) throw styleError('style-not-a-string', `The style "${name}" in ${fileRel} is not a string of classes.`, 'Write it as a plain string to update it with commands.', fileRel);

  let classes = options.classes !== undefined ? options.classes.split(/\s+/).filter(Boolean) : (literal?.text.split(/\s+/).filter(Boolean) ?? []);
  if (options.classes === undefined) {
    const layout = options.layout ?? {};
    for (const key of ROOT_STYLE_KEYS) {
      if (!(key in layout) || options.state) continue;
      const pattern = MANAGED_STYLES[key].tailwind;
      const at = classes.findIndex((candidate) => pattern.test(candidate));
      classes = classes.filter((candidate) => !pattern.test(candidate));
      classes.splice(at === -1 ? classes.length : at, 0, ...(layout[key] === null ? [] : tailwindClasses(key, layout as RootStyle)));
    }
    if (FLEX_KEYS.some((key) => layout[key] !== undefined && layout[key] !== null) && !classes.includes('flex')) classes.unshift('flex');

    const apply = (declarations: Declaration[], state?: StyleState) => {
      for (const declaration of declarations) {
        const pattern = tailwindClassesFor(declaration[0], state);
        classes = [...classes.filter((candidate) => !pattern.test(candidate)), arbitraryProperty(declaration, state)];
      }
    };
    apply(options.input?.base ?? [], options.state);
    for (const [state, declarations] of Object.entries(options.input?.states ?? {})) apply(declarations ?? [], state as StyleState);
  }

  const value = `'${classes.join(' ')}'`;
  if (literal) return text.slice(0, literal.getStart(sourceFile)) + value + text.slice(literal.getEnd());
  return insertListItem(text, sourceFile, object, [`${name}: ${value}`]);
}

/** The style an element uses: "root" for className={styles.root}. Undefined without one; an error for other classNames. */
function elementStyle(opening: ts.JsxOpeningLikeElement, sourceFile: ts.SourceFile, file: string): string | undefined {
  const attribute = opening.attributes.properties.find(
    (candidate): candidate is ts.JsxAttribute => ts.isJsxAttribute(candidate) && candidate.name.getText(sourceFile) === 'className',
  );
  if (!attribute) return undefined;
  const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
  if (expression && ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'styles') {
    return expression.name.text;
  }
  // A styleable component's root: className={cx(styles.root, className)}.
  const first = expression && ts.isCallExpression(expression) && expression.expression.getText(sourceFile) === 'cx' ? expression.arguments[0] : undefined;
  if (first && ts.isPropertyAccessExpression(first) && ts.isIdentifier(first.expression) && first.expression.text === 'styles') return first.name.text;
  throw styleError(
    'style-classname-unsupported',
    `The element's className is "${attribute.initializer?.getText(sourceFile) ?? ''}", not a style of its style file.`,
    'Commands update styles written as className={styles.<name>}.',
    file,
  );
}

/**
 * Plans updating the style of an element, in the style file next to its file: layout options and
 * declarations merged property by property (base or state rules), or Tailwind classes replaced.
 * An element without a style gets one with `name`.
 */
export async function planStyleUpdate(changes: ChangeSet, config: ResolvedConfig, options: StyleUpdateOptions): Promise<StyleUpdateResult> {
  if (options.classes !== undefined && config.styles !== 'tailwind') {
    throw styleError('style-class-not-tailwind', '--class sets Tailwind classes, but the project uses CSS Modules.', 'Pass the style as CSS (--css, --css-file) or as a style object (--object, --object-file).');
  }
  if (options.name !== undefined && (!/^[a-z][A-Za-z0-9]*$/.test(options.name) || options.name === 'root')) {
    throw styleError('style-name-invalid', `"${options.name}" is not a valid style name.`, 'Use a camelCase name other than "root", e.g. "brand" or "navLinks".');
  }

  const { file, element, tree } = await resolveTarget(changes.root, config, options.target);
  if (element.kind !== 'element') throw styleError('style-target-not-element', `${options.target} is a prop, not an element.`, 'Point at an element.', file);
  const sourceFile = tree.sourceFile;
  const jsx = element.node as ts.JsxElement | ts.JsxSelfClosingElement;
  const opening = ts.isJsxElement(jsx) ? jsx.openingElement : jsx;
  const existing = elementStyle(opening, sourceFile, file);
  if (existing && options.name && options.name !== existing) {
    throw styleError('style-name-conflict', `The element already uses the style "${existing}".`, `Leave out --name, or use --name ${existing}.`, file);
  }
  const layoutGiven = Object.values(options.layout ?? {}).some((value) => value !== undefined);
  if (layoutGiven && isTableElement(element.tag)) {
    throw styleError('style-layout-not-allowed', `<${element.tag}> is laid out by its table: layout options would break it.`, 'Style it with --css instead, e.g. "padding: 8px; text-align: left".', file);
  }
  const name = existing ?? options.name;
  if (!name) {
    throw styleError('style-name-required', `<${element.tag}> has no style yet.`, 'Give it one with --name, e.g. --name link: it adds className={styles.link}.', file);
  }
  let condition: Condition | undefined;
  let conditionEdit: [number, string] | undefined;
  let conditionProp: string | undefined;
  if (options.when !== undefined) {
    if (config.styles === 'tailwind') throw styleError('when-not-tailwind', '--when is for CSS Modules for now.', 'With Tailwind, write the variant in the classes, e.g. "data-[selected=true]:text-primary".', file);
    if (layoutGiven) throw styleError('options-conflict', 'Layout options apply to the element itself, not under a condition.', 'Pass the declarations with --css.', file);
    const planned = planCondition(options.when, tree, element, file);
    const rootStyle = planned.condition.rootStyle ?? (planned.condition.self ? name : undefined);
    if (!rootStyle) throw styleError('when-root-unstyled', `The root of ${tree.component} has no style to carry the condition.`, `Give it one first: "style update <root> --name root --css …".`, file);
    condition = { ...planned.condition, rootStyle };
    conditionEdit = planned.edit;
    conditionProp = planned.prop;
  }

  // A component of the project takes its first style like any element, once it is styleable.
  let classProp = 'className';
  if (!existing && isComponentName(element.tag)) {
    const source = await findComponentSource(changes, config, file, sourceFile.getFullText(), element.tag);
    if (source.kind === 'project') classProp = await planComponentStyling(changes, config, source.folderRel!, element.tag, [], true);
  }

  const base = path.posix.basename(file).replace(/\.[jt]sx?$/, '');
  const fileName = `${base}${STYLE_FILE_SUFFIXES[config.styles]}`;
  const styleRel = `${path.posix.dirname(file)}/${fileName}`;
  const text = (await changes.read(styleRel)) ?? (config.styles === 'tailwind' ? 'export const styles = {\n};\n' : '');
  const updated = config.styles === 'tailwind' ? updateTailwind(text, name, options, styleRel) : updateCss(text, name, options, condition);
  if (updated === text && existing && !conditionEdit) {
    changes.skip(styleRel, `"${name}" already has this style`);
    return { style: name, file: styleRel };
  }
  const qualifiers = [options.state, options.when && `when ${options.when}`].filter(Boolean).join(', ');
  changes.write(styleRel, updated, { type: (await changes.read(styleRel)) === undefined ? 'create' : 'update', message: `style "${name}"${qualifiers ? ` (${qualifiers})` : ''}` });

  // The component's edits, from the end of the file back so the positions hold: the element's className, the root's attribute.
  const edits: [number, string][] = [];
  if (!existing) edits.push([opening.tagName.getEnd(), ` ${classProp}={styles.${name}}`]);
  if (conditionEdit) edits.push(conditionEdit);
  if (edits.length) {
    let component = sourceFile.getFullText();
    for (const [at, insert] of edits.sort((a, b) => b[0] - a[0])) component = `${component.slice(0, at)}${insert}${component.slice(at)}`;
    if (conditionEdit) component = applyNames(component, file, tree.component, [conditionProp!]);
    if (!existing && !/^import\s+(styles|\{\s*styles\s*\})\s+from\s/m.test(component)) {
      const statement = config.styles === 'tailwind' ? `import { styles } from './${fileName.replace(/\.ts$/, '')}'` : `import styles from './${fileName}'`;
      component = addImport(component, ts.createSourceFile(file, component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), statement);
    }
    const what = [!existing && `gave <${element.tag}> the style "${name}"`, conditionEdit && `showed "${conditionProp}" on the root as ${condition!.attribute}`].filter(Boolean).join(' and ');
    changes.write(file, component, { type: 'update', message: what });
  }
  return { style: name, file: styleRel };
}
