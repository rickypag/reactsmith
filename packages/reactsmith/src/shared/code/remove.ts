import ts from 'typescript';

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

/** Whether the identifier declares or labels something rather than reading a value: an import, a binding, a key. */
function isDeclaration(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ((ts.isBindingElement(parent) || ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) &&
      (parent.name === node || ('propertyName' in parent && parent.propertyName === node))) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ts.isJsxAttribute(parent)
  );
}

/** Whether `name` is read anywhere in `text`: not counting where it is imported, destructured or declared. */
export function isReferenced(text: string, name: string): boolean {
  const sourceFile = ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let used = false;
  const visit = (node: ts.Node): void => {
    if (used || ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === name && !isDeclaration(node)) used = true;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return used;
}

/** Whether the file imports `name`. */
export function isImported(text: string, name: string): boolean {
  return findImport(ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), name) !== undefined;
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
