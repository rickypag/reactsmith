import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport, insertListItem } from '../code/insert.js';
import { checkInsertionTarget, insertJsx, type InsertPosition } from '../components/insert.js';
import { CONFIG_FILE, HTML_SOURCE, STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { cssValue, DEFAULT_LAYOUT, MANAGED_STYLES, ROOT_STYLE_KEYS, tailwindClasses, type RootStyle } from '../styles/layout.js';
import { resolveTarget } from './ids.js';

export interface ElementInsertOptions {
  /** An HTML layout or text element: "div", "nav", "span", "h1", "a"… */
  tag: string;
  /** An element id or "file:line[:column]". */
  target: string;
  position: InsertPosition;
  /** The text of a text element. */
  text?: string;
  /** The link of an "a". */
  href?: string;
  /** A style name: adds `className={styles.<name>}` and its rule in the component's style file. */
  name?: string;
  /** The layout of a layout element; needs a name, which holds it. */
  style?: RootStyle;
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

/** Text as JSX: as written, or as a string expression when it has characters JSX would read as code. */
export function jsxText(text: string): string {
  return /[{}<>]/.test(text) ? `{${JSON.stringify(text)}}` : text;
}

function jsxAttribute(name: string, value: string): string {
  return value.includes('"') ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
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
 * Plans inserting an HTML element into a layout element of a component, a view or a layout:
 * a layout element to arrange other elements, or a text element with its text. With a name,
 * the element gets its own style in the file's style file, which holds the layout of a layout element.
 */
export async function planElementInsert(changes: ChangeSet, config: ResolvedConfig, options: ElementInsertOptions): Promise<ElementInsertResult> {
  const { tag, name, style, text, href, position } = options;
  const layoutTags = config.layoutComponents[HTML_SOURCE] ?? [];
  const textTags = config.textComponents[HTML_SOURCE] ?? [];
  const isLayout = layoutTags.includes(tag);
  const isText = textTags.includes(tag);

  if (!isLayout && !isText) {
    throw elementError(
      'element-tag-not-allowed',
      `"${tag}" is neither a layout nor a text element.`,
      `Layout: ${layoutTags.join(', ')}. Text: ${textTags.join(', ')}. See "layoutComponents" and "textComponents" in ${CONFIG_FILE}.`,
    );
  }
  if (text !== undefined && !isText) throw elementError('element-text-not-allowed', `"${tag}" is a layout element, so it cannot hold text.`, `Insert a text element into it, e.g. "element insert span --text …".`);
  if (href !== undefined && tag !== 'a') throw elementError('element-href-not-allowed', '--href is only for links ("a").', 'Insert an "a" element instead.');
  if (style && !isLayout) throw elementError('element-layout-not-allowed', `"${tag}" is a text element: layout options are for layout elements.`, 'Style it in its rule in the style file instead.');
  if (style && !name) throw elementError('element-name-required', 'Layout options need a --name: the style that holds them.', 'Add e.g. --name links.');
  if (name !== undefined && (!/^[a-z][A-Za-z0-9]*$/.test(name) || name === 'root')) {
    throw elementError('element-name-invalid', `"${name}" is not a valid style name.`, 'Use a camelCase name other than "root", e.g. "brand" or "navLinks".');
  }

  const resolved = await resolveTarget(changes.root, config, options.target);
  checkInsertionTarget(resolved, position);
  const { id, file, element, tree } = resolved;

  const attributes = [...(name ? [`className={styles.${name}}`] : []), ...(href !== undefined ? [jsxAttribute('href', href)] : [])];
  const opening = `<${tag}${attributes.map((attribute) => ` ${attribute}`).join('')}`;
  const jsx = text === undefined ? `${opening} />` : `${opening}>${jsxText(text)}</${tag}>`;

  let updated = insertJsx(tree.sourceFile.getFullText(), tree.sourceFile, element, position, jsx);
  const styleImport = name ? await planStyle(changes, config, file, updated, name, style) : undefined;
  if (styleImport) updated = addImport(updated, ts.createSourceFile(file, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), styleImport);

  const where = position === 'inside' ? `into ${element.path}` : position === 'first' ? `at the start of ${element.path}` : `${position} ${element.path}`;
  changes.write(file, updated, { type: 'update', message: `inserted <${tag}> ${where}` });
  return { file, target: id };
}
