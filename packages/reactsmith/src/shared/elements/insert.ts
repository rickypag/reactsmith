import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport, addNamedImport, insertListItem } from '../code/insert.js';
import { checkInsertionTarget, checkList, insertJsx, type InsertPosition, type ListOptions } from './position.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { availableConstants } from '../constants/files.js';
import { findComponentSource } from '../imports/lookup.js';
import { IssueError } from '../issues.js';
import { cssValue, DEFAULT_LAYOUT, MANAGED_STYLES, ROOT_STYLE_KEYS, tailwindClasses, type RootStyle } from '../styles/layout.js';
import { assertInlineStyleLimit } from '../structure/inline-styles.js';
import { planComponentStyling } from '../styles/styleable.js';
import { assertValidJsx } from '../types/check.js';
import { applyNames } from '../values/scope.js';
import { jsxText, parseValue, rootNames } from '../values/template.js';
import { resolveTarget } from './ids.js';
import { elementKind, holdsText, isComponentName, isHtmlTag } from './kinds.js';
import { checkDeclaredProps, declaredProps, parseAttributes } from './props.js';

export interface ElementInsertOptions {
  /** What to insert: an HTML tag ("div", "img") or a component ("NavLink", "NavMenu"). */
  tag: string;
  /** An element id or "file:line[:column]". */
  target: string;
  position: InsertPosition;
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

/**
 * Plans inserting an element into a layout or interactive element of a component, a view or a layout: an HTML tag,
 * or a component of the project or of a package, imported from where it is found (or from --from). Its props are
 * checked against the component's interface, or against TypeScript's types for HTML and package elements.
 * With a name, the element gets its own style in the file's style file, which holds the layout of a layout element.
 * With a list, the component is repeated over it.
 */
export async function planElementInsert(changes: ChangeSet, config: ResolvedConfig, options: ElementInsertOptions): Promise<ElementInsertResult> {
  const { tag, name, style, text, position, list } = options;
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
  checkInsertionTarget(resolved, position);
  const kind = elementKind(config, tag, source?.kindSource);

  if (textParts && !holdsText(kind)) {
    throw elementError('element-text-not-allowed', `<${tag}> holds no text: only text elements (span, p…) and interactive ones (a, button…) do.`, 'Insert a text element into it, or give it its text through --props.', file);
  }
  if (style && kind !== 'layout') throw elementError('element-layout-not-allowed', `<${tag}> is not a layout element: layout options are for layout elements.`, 'Style it in its rule in the style file instead.', file);
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

  let updated = insertJsx(original, tree.sourceFile, element, position, jsx);
  updated = applyNames(updated, file, tree.component, [...new Set(used)], { constants: await availableConstants(changes, config, file) });
  if (source && !source.imported) updated = addNamedImport(updated, file, tag, source.specifier);
  const styleImport = name ? await planStyle(changes, config, file, updated, name, style) : undefined;
  if (styleImport) updated = addImport(updated, ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), styleImport);
  // HTML and package elements have no interface of ours: TypeScript says which props they take.
  if (source?.kind === 'package' || (html && props.attributes.length > 0)) assertValidJsx(changes.root, file, updated, jsx, tag);

  const where = position === 'inside' ? `into ${element.path}` : position === 'first' ? `at the start of ${element.path}` : `${position} ${element.path}`;
  const what = list ? `a list of <${tag}> over ${list.each}` : `<${tag}>`;
  const imported = source && !source.imported ? ` and its import from "${source.specifier}"` : '';
  changes.write(file, updated, { type: 'update', message: `inserted ${what} ${where}${imported}` });
  return { file, target: id };
}
