import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { addImport } from '../code/insert.js';
import type { ResolvedConfig } from '../config/types.js';
import { resolveTarget, type ResolvedElement } from '../elements/ids.js';
import { allNodes, type ElementNode } from '../elements/tree.js';
import { relativeImport, specifierPath } from '../imports/specifiers.js';
import { IssueError } from '../issues.js';
import { componentScope, type ComponentOwner } from './scope.js';

/** Where the component goes, relative to the target: its last or first child, or a sibling before or after it. */
export const INSERT_POSITIONS = ['inside', 'first', 'before', 'after'] as const;
export type InsertPosition = (typeof INSERT_POSITIONS)[number];

export interface ComponentInsertOptions {
  owner: ComponentOwner;
  /** PascalCase component name: "UserCard". */
  name: string;
  /** An element id or "file:line[:column]". */
  target: string;
  position: InsertPosition;
  /** JSX attributes for the new element: 'title="Docs" items={[]}'. */
  props?: string;
}

export interface ComponentInsertResult {
  /** Project-relative path of the edited file. */
  file: string;
  /** The id of the target element. */
  target: string;
}

function insertError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

function lineStartOf(text: string, offset: number): number {
  return text.lastIndexOf('\n', offset - 1) + 1;
}

function indentAt(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(lineStartOf(text, offset)))![0];
}

/** Whether `node` is alone on its lines: only whitespace before its start and after its end. */
function isAlone(text: string, start: number, end: number): boolean {
  const newline = text.indexOf('\n', end);
  return text.slice(lineStartOf(text, start), start).trim() === '' && text.slice(end, newline === -1 ? text.length : newline).trim() === '';
}

/** The props of a component: every member of `<Name>Props`, and which ones are required. */
function componentProps(text: string, name: string): { all: Set<string>; required: string[] } {
  const sourceFile = ts.createSourceFile(`${name}.tsx`, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const props = sourceFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === `${name}Props`,
  );
  const members = (props?.members ?? []).filter((member) => member.name && ts.isIdentifier(member.name));
  return {
    all: new Set(members.map((member) => (member.name as ts.Identifier).text)),
    required: members.filter((member) => !member.questionToken).map((member) => (member.name as ts.Identifier).text),
  };
}

/** Checks the JSX attributes against the component's props and returns them normalized, with a leading space. */
function checkAttributes(attributes: string | undefined, name: string, props: { all: Set<string>; required: string[] }): string {
  const text = attributes?.trim() ?? '';
  const sourceFile = ts.createSourceFile('attributes.tsx', `<${name} ${text} />;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const { diagnostics } = ts.transpileModule(sourceFile.text, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: 'a.tsx' });
  const statement = sourceFile.statements[0];
  const element = statement && ts.isExpressionStatement(statement) ? statement.expression : undefined;
  if (diagnostics?.length || sourceFile.statements.length !== 1 || !element || !ts.isJsxSelfClosingElement(element)) {
    throw insertError('props-invalid', `The props "${text}" are not valid JSX attributes.`, 'Write them as in JSX: \'title="Docs" items={[]}\'.');
  }

  const given = new Set<string>();
  for (const attribute of element.attributes.properties) {
    // A spread may provide any prop, so the required ones cannot be checked.
    if (ts.isJsxSpreadAttribute(attribute)) return ` ${text}`;
    const prop = attribute.name.getText(sourceFile);
    if (!props.all.has(prop)) {
      const known = props.all.size ? `Its props are: ${[...props.all].join(', ')}.` : 'It has no props.';
      throw insertError('props-unknown', `"${name}" has no prop "${prop}".`, known);
    }
    given.add(prop);
  }
  const missing = props.required.filter((prop) => !given.has(prop));
  if (missing.length) {
    throw insertError(
      'props-required',
      `"${name}" needs ${missing.map((prop) => `"${prop}"`).join(', ')}, or the code would not compile.`,
      `Pass ${missing.length === 1 ? 'it' : 'them'} with --props, e.g. --props '${missing.map((prop) => `${prop}={…}`).join(' ')}'.`,
    );
  }
  return text ? ` ${text}` : '';
}

/**
 * Checks that something can be inserted at `position` relative to the target: into it (inside, first),
 * it must be a layout element; next to it (before, after), its parent must be one.
 */
export function checkInsertionTarget({ id, file, element, tree }: ResolvedElement, position: InsertPosition): void {
  const parent = allNodes(tree.roots).find((node) => node.children.includes(element));
  const sibling = position === 'before' || position === 'after';
  const container = sibling ? parent : element;
  if (container?.layout) return;
  const what = sibling ? `the parent of ${id}` : id;
  const why = container ? `"${container.tag}" is not a layout element` : `${element.tag} is the root of the component`;
  throw insertError('insert-target-not-layout', `Cannot insert ${sibling ? position : 'into'} ${id}: ${why}.`, `Elements go into layout elements (see "layoutComponents"); ${what} is not one.`, file);
}

/** Inserts `jsx` into `text` at `position` relative to `target`, keeping the indentation of the code around it. */
export function insertJsx(text: string, sourceFile: ts.SourceFile, target: ElementNode, position: InsertPosition, jsx: string): string {
  const node = target.node as ts.JsxElement | ts.JsxSelfClosingElement;
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const splice = (at: number, insert: string) => text.slice(0, at) + insert + text.slice(at);

  if (position === 'before' || position === 'after') {
    if (!isAlone(text, start, end)) return position === 'before' ? splice(start, jsx) : splice(end, jsx);
    const indent = indentAt(text, start);
    return position === 'before' ? splice(lineStartOf(text, start), `${indent}${jsx}\n`) : splice(end, `\n${indent}${jsx}`);
  }

  const indent = indentAt(text, start);
  if (ts.isJsxSelfClosingElement(node)) {
    // <div /> becomes <div>…</div>, with the new element on its own line.
    const opening = text.slice(start, end).replace(/\s*\/>$/, '>');
    // Right after "return", the element moves into "return ( … );", the way multi-line JSX is written.
    if (/\breturn\s*$/.test(text.slice(lineStartOf(text, start), start))) {
      const inner = `${indent}  `;
      const block = `(\n${inner}${opening}\n${inner}  ${jsx}\n${inner}</${target.tag}>\n${indent})`;
      return text.slice(0, start) + block + text.slice(end);
    }
    return text.slice(0, start) + `${opening}\n${indent}  ${jsx}\n${indent}</${target.tag}>` + text.slice(end);
  }

  const openEnd = node.openingElement.getEnd();
  const closeStart = node.closingElement.getStart(sourceFile);
  const children = target.children.filter((child) => child.kind === 'element');
  const multiline = text.slice(start, closeStart).includes('\n');
  if (!multiline) return position === 'first' ? splice(openEnd, jsx) : splice(closeStart, jsx);

  const childIndent = children[0] ? indentAt(text, children[0].node.getStart(sourceFile)) : `${indent}  `;
  if (position === 'first') return splice(openEnd, `\n${childIndent}${jsx}`);
  // Before the closing tag: on its own line when the closing tag starts its line.
  const closeLine = lineStartOf(text, closeStart);
  return text.slice(closeLine, closeStart).trim() === '' ? splice(closeLine, `${childIndent}${jsx}\n`) : splice(closeStart, `\n${childIndent}${jsx}\n${indent}`);
}

/**
 * Plans inserting a component of a feature (or of the app) into a layout element of a file of the same feature (or of the app):
 * the element with the given props, and its import when the file does not have it yet.
 * The target is an element id or "file:line[:column]".
 */
export async function planComponentInsert(changes: ChangeSet, config: ResolvedConfig, options: ComponentInsertOptions): Promise<ComponentInsertResult> {
  const { owner, name, position } = options;
  const root = changes.root;
  const scope = componentScope(config, owner);
  const componentRel = `${scope.componentsRel}/${name}`;

  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw insertError('component-name-invalid', `"${name}" is not a valid component name.`, 'Use a PascalCase name like "UserCard".');
  }
  const mainText = await readFile(path.join(root, componentRel, `${name}.tsx`), 'utf8').catch(() => undefined);
  if (mainText === undefined || !(await stat(path.join(root, componentRel, 'index.ts')).catch(() => undefined))) {
    throw insertError('component-missing', `There is no component "${name}" in ${scope.label}.`, `Create it first with "component create ${name} ${'feature' in owner ? `--feature ${owner.feature}` : '--app'}".`, componentRel);
  }

  const { id, file, element, tree } = await resolveTarget(root, config, options.target);
  if (!file.startsWith(`${scope.scopeRel}/`)) {
    throw insertError('insert-out-of-scope', `${file} is not in ${scope.label}.`, 'Feature components go into views and components of their feature; app components into the app folder (layouts, views, components).', file);
  }
  if (file.startsWith(`${componentRel}/`)) {
    throw insertError('insert-into-itself', `${file} belongs to "${name}" itself, which would render itself forever.`, 'Choose an element of another component or view.', file);
  }

  checkInsertionTarget({ id, file, element, tree }, position);

  const sourceFile = tree.sourceFile;
  const absolute = path.join(root, file);
  const specifier = relativeImport(file, `${componentRel}/index.ts`);
  const existing = sourceFile.statements.filter(ts.isImportDeclaration).find((declaration) => {
    const bindings = declaration.importClause?.namedBindings;
    return declaration.importClause?.name?.text === name || (bindings && ts.isNamedImports(bindings) && bindings.elements.some((e) => e.name.text === name));
  });
  if (existing) {
    const from = (existing.moduleSpecifier as ts.StringLiteral).text;
    const same = specifierPath(from, absolute, path.join(root, config.srcDir), config.alias)?.base === path.join(root, componentRel);
    if (!same) {
      throw insertError('insert-name-taken', `${file} already imports another "${name}" from "${from}".`, 'Rename one of them, or insert the component by hand.', file);
    }
  }

  const attributes = checkAttributes(options.props, name, componentProps(mainText, name));
  let updated = insertJsx(sourceFile.getFullText(), sourceFile, element, position, `<${name}${attributes} />`);
  if (!existing) {
    const updatedFile = ts.createSourceFile(absolute, updated, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    updated = addImport(updated, updatedFile, `import { ${name} } from '${specifier}'`);
  }

  const where = position === 'inside' ? `into ${element.path}` : position === 'first' ? `at the start of ${element.path}` : `${position} ${element.path}`;
  changes.write(file, updated, { type: 'update', message: `inserted <${name}> ${where}${existing ? '' : ' and its import'}` });
  return { file, target: id };
}
