import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { resolveTarget } from '../elements/ids.js';
import { allNodes } from '../elements/tree.js';
import { specifierPath } from '../imports/specifiers.js';
import { IssueError } from '../issues.js';

export interface ComponentRemoveResult {
  /** The removed element's id. */
  id: string;
  component: string;
  /** Project-relative path of the edited file. */
  file: string;
}

function removeError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The import that binds `local`, and the binding itself. */
function findImport(sourceFile: ts.SourceFile, local: string): { declaration: ts.ImportDeclaration; binding: ts.Node } | undefined {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const clause = statement.importClause;
    if (clause.name?.text === local) return { declaration: statement, binding: clause.name };
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const element = bindings.elements.find((candidate) => candidate.name.text === local);
      if (element) return { declaration: statement, binding: element };
    }
  }
  return undefined;
}

/** The range of `node`, widened to whole lines when nothing else is on them, so no blank line is left. */
export function removalRange(text: string, start: number, end: number): [number, number] {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const newline = text.indexOf('\n', end);
  const lineEnd = newline === -1 ? text.length : newline + 1;
  const alone = text.slice(lineStart, start).trim() === '' && text.slice(end, lineEnd).trim() === '';
  return alone ? [lineStart, lineEnd] : [start, end];
}

export function cut(text: string, [start, end]: [number, number]): string {
  return text.slice(0, start) + text.slice(end);
}

/** Whether `name` is still used in `text` outside its import. */
export function isStillUsed(text: string, name: string): boolean {
  const sourceFile = ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let used = false;
  const visit = (node: ts.Node): void => {
    if (used || ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === name) used = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return used;
}

/** Removes the import binding of `name`, or the whole import when it was the only one. */
export function removeImport(text: string, name: string): string {
  const sourceFile = ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = findImport(sourceFile, name);
  if (!found) return text;
  const { declaration, binding } = found;
  const clause = declaration.importClause!;
  const named = clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements : undefined;
  const remaining = (clause.name ? 1 : 0) + (named?.length ?? (clause.namedBindings ? 1 : 0)) - 1;
  if (remaining === 0) {
    const [start, end] = removalRange(text, declaration.getStart(sourceFile), declaration.getEnd());
    // Don't leave the file starting with a blank line, or two blank lines in a row.
    const blankAfter = /^\r?\n/.exec(text.slice(end))?.[0].length ?? 0;
    const blankBefore = start === 0 || /\n\r?\n$/.test(text.slice(0, start));
    return cut(text, [start, blankBefore ? end + blankAfter : end]);
  }

  if (ts.isImportSpecifier(binding) && named) {
    // The only named import next to a default one: drop ", { Name }".
    if (named.length === 1) return cut(text, [clause.name!.getEnd(), clause.namedBindings!.getEnd()]);
    // Remove "Name, " or, for the last one, ", Name" so the list stays well formed.
    const index = named.indexOf(binding);
    const last = index === named.length - 1;
    return cut(text, last ? [named[index - 1]!.getEnd(), binding.getEnd()] : [binding.getStart(sourceFile), named[index + 1]!.getStart(sourceFile)]);
  }
  // A default import next to named ones: drop "Name, ".
  return cut(text, [binding.getStart(sourceFile), clause.namedBindings!.getStart(sourceFile)]);
}

/**
 * Plans removing a component usage, given by id or "file:line[:column]": the element is deleted
 * from its parent layout element and its import is dropped when nothing else in the file uses it.
 * The component's own files are kept.
 */
export async function planComponentRemove(changes: ChangeSet, config: ResolvedConfig, target: string): Promise<ComponentRemoveResult> {
  const root = changes.root;
  const { id, file, element, tree } = await resolveTarget(root, config, target);
  const sourceFile = tree.sourceFile;
  const name = element.tag;

  const found = element.kind === 'element' && /^[A-Z]/.test(name) ? findImport(sourceFile, name) : undefined;
  const specifier = found && ts.isStringLiteral(found.declaration.moduleSpecifier) ? found.declaration.moduleSpecifier.text : undefined;
  const isProjectComponent =
    specifier !== undefined && specifierPath(specifier, path.join(root, file), path.join(root, config.srcDir), config.alias) !== undefined;
  if (!isProjectComponent) {
    throw removeError(
      'remove-not-a-component',
      `"${name}" at ${id} is not a component of the project.`,
      'Only components imported from the project can be removed this way; edit other elements by hand.',
      file,
    );
  }

  const parent = allNodes(tree.roots).find((node) => node.children.includes(element));
  if (!parent?.layout) {
    const where = parent ? `"${parent.tag}", which is not a layout element` : 'the root of the component';
    throw removeError(
      'remove-parent-not-layout',
      `"${name}" is in ${where}, so removing it would leave invalid code.`,
      'Components can be removed only from layout elements (see "layoutComponents").',
      file,
    );
  }

  const text = sourceFile.getFullText();
  let updated = cut(text, removalRange(text, element.node.getStart(sourceFile), element.node.getEnd()));
  const importRemoved = !isStillUsed(updated, name);
  if (importRemoved) updated = removeImport(updated, name);

  changes.write(file, updated, { type: 'update', message: `removed <${name}> from ${parent.path}${importRemoved ? ' and its import' : ''}` });
  return { id, component: name, file };
}
