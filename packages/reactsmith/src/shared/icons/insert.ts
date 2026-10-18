import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport } from '../code/insert.js';
import { insertJsx, type InsertPosition } from '../components/insert.js';
import type { ResolvedConfig } from '../config/types.js';
import { resolveTarget } from '../elements/ids.js';
import { allNodes, type ElementNode } from '../elements/tree.js';
import { IssueError } from '../issues.js';
import { createTextClassifier } from '../layout/classify.js';
import { loadIconNames, requireIcons, resolveIconName } from './library.js';

export interface IconInsertOptions {
  /** The icon, as on the library's website ("arrow-right") or as a component ("ArrowRight"). */
  icon: string;
  /** An element id or "file:line[:column]". */
  target: string;
  position: InsertPosition;
  /** The icon's size in pixels; the library's default when missing. */
  size?: number;
}

export interface IconInsertResult {
  /** The icon component: "ArrowRight". */
  icon: string;
  /** Project-relative path of the edited file. */
  file: string;
  /** The id of the target element. */
  target: string;
}

function iconError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** Adds `name` to the import from `library`, or a new import when the file has none. */
function addIconImport(text: string, fileName: string, name: string, library: string): string {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== library) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings) || statement.importClause?.isTypeOnly) continue;
    if (bindings.elements.some((element) => element.name.text === name)) return text;
    const last = bindings.elements[bindings.elements.length - 1];
    if (!last) continue;
    return `${text.slice(0, last.getEnd())}, ${name}${text.slice(last.getEnd())}`;
  }
  return addImport(text, sourceFile, `import { ${name} } from '${library}'`);
}

/** The name a file already uses for something else than this icon, which would clash with it. */
function clashingImport(sourceFile: ts.SourceFile, name: string, library: string): string | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    const names = [
      ...(clause?.name ? [clause.name.text] : []),
      ...(bindings && ts.isNamedImports(bindings) ? bindings.elements.map((element) => element.name.text) : []),
      ...(bindings && ts.isNamespaceImport(bindings) ? [bindings.name.text] : []),
    ];
    if (names.includes(name) && statement.moduleSpecifier.text !== library) return statement.moduleSpecifier.text;
  }
  return undefined;
}

/**
 * Plans inserting an icon of the project's icon library: into a layout element, or into a text element
 * such as a button or a link, next to its text. The icon must exist in the installed library.
 */
export async function planIconInsert(changes: ChangeSet, config: ResolvedConfig, options: IconInsertOptions): Promise<IconInsertResult> {
  const root = changes.root;
  const library = await requireIcons(root, config);
  const icon = resolveIconName(options.icon, loadIconNames(root, library), library);
  if (options.size !== undefined && !(Number.isInteger(options.size) && options.size > 0)) {
    throw iconError('icon-size-invalid', `"${options.size}" is not a valid icon size.`, 'Use a size in pixels, e.g. --size 16.');
  }

  const { id, file, element, tree } = await resolveTarget(root, config, options.target);
  const sourceFile = tree.sourceFile;
  const absolute = path.join(root, file);
  const isText = createTextClassifier(sourceFile, absolute, root, config);
  const holds = (node: ElementNode | undefined) => {
    if (!node || node.kind !== 'element') return false;
    const jsx = node.node as ts.JsxElement | ts.JsxSelfClosingElement;
    return node.layout || isText((ts.isJsxElement(jsx) ? jsx.openingElement : jsx).tagName);
  };
  const sibling = options.position === 'before' || options.position === 'after';
  const container = sibling ? allNodes(tree.roots).find((node) => node.children.includes(element)) : element;
  if (!holds(container)) {
    const why = container ? `"${container.tag}" is neither a layout nor a text element` : `${element.tag} is the root of the component`;
    throw iconError('insert-target-not-layout', `Cannot insert ${sibling ? options.position : 'into'} ${id}: ${why}.`, 'Icons go into layout elements, or into text elements next to their text (a button, a link…).', file);
  }

  const clash = clashingImport(sourceFile, icon, library);
  if (clash) throw iconError('insert-name-taken', `${file} already imports another "${icon}" from "${clash}".`, 'Rename that import, or insert the icon by hand with an alias.', file);

  const jsx = options.size === undefined ? `<${icon} />` : `<${icon} size={${options.size}} />`;
  let updated = insertJsx(sourceFile.getFullText(), sourceFile, element, options.position, jsx);
  updated = addIconImport(updated, absolute, icon, library);

  const where = options.position === 'inside' ? `into ${element.path}` : options.position === 'first' ? `at the start of ${element.path}` : `${options.position} ${element.path}`;
  changes.write(file, updated, { type: 'update', message: `inserted the icon <${icon}> ${where}` });
  return { icon, file, target: id };
}
