import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport, insertListItem } from '../code/insert.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { resolveTarget } from '../elements/ids.js';
import { IssueError } from '../issues.js';
import { isComponentName } from '../elements/kinds.js';
import { findComponentSource } from '../imports/lookup.js';
import { planComponentStyling } from './styleable.js';
import { arbitraryProperty, stateSelector, tailwindClassesFor, type Declaration, type StyleInput, type StyleState } from './declarations.js';
import { cssValue, MANAGED_STYLES, ROOT_STYLE_KEYS, tailwindClasses, type RootStyle, type RootStyleKey } from './layout.js';

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
function updateCss(text: string, name: string, options: StyleUpdateOptions): string {
  const own = new RegExp(`(^|\\n)\\.${escapeRegExp(name)}(:[\\w-]+)?\\s*\\{`);
  const layout = options.layout ?? {};
  const given = options.input?.base ?? [];
  const addFlex = FLEX_KEYS.some((key) => layout[key] !== undefined && layout[key] !== null);

  if (options.state) {
    const states = { ...(options.input?.states ?? {}), [options.state]: [...(options.input?.states[options.state] ?? []), ...given] };
    return Object.entries(states).reduce((updated, [state, declarations]) => updateRule(updated, `.${name}${stateSelector(state as StyleState)}`, declarations ?? [], [], false, own), text);
  }
  const base = baseDeclarations(layout, given);
  let updated = updateRule(text, `.${name}`, base.set, base.removed, addFlex, own);
  for (const [state, declarations] of Object.entries(options.input?.states ?? {})) {
    updated = updateRule(updated, `.${name}${stateSelector(state as StyleState)}`, declarations ?? [], [], false, own);
  }
  return updated;
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
  const name = existing ?? options.name;
  if (!name) {
    throw styleError('style-name-required', `<${element.tag}> has no style yet.`, 'Give it one with --name, e.g. --name link: it adds className={styles.link}.', file);
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
  const updated = config.styles === 'tailwind' ? updateTailwind(text, name, options, styleRel) : updateCss(text, name, options);
  if (updated === text && existing) {
    changes.skip(styleRel, `"${name}" already has this style`);
    return { style: name, file: styleRel };
  }
  changes.write(styleRel, updated, { type: (await changes.read(styleRel)) === undefined ? 'create' : 'update', message: `style "${name}"${options.state ? ` (${options.state})` : ''}` });

  if (!existing) {
    // className={styles.<name>} on the element, and the styles import when the file has none.
    const at = opening.tagName.getEnd();
    let component = sourceFile.getFullText();
    component = `${component.slice(0, at)} ${classProp}={styles.${name}}${component.slice(at)}`;
    if (!/^import\s+(styles|\{\s*styles\s*\})\s+from\s/m.test(component)) {
      const statement = config.styles === 'tailwind' ? `import { styles } from './${fileName.replace(/\.ts$/, '')}'` : `import styles from './${fileName}'`;
      component = addImport(component, ts.createSourceFile(file, component, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), statement);
    }
    changes.write(file, component, { type: 'update', message: `gave <${element.tag}> the style "${name}"` });
  }
  return { style: name, file: styleRel };
}
