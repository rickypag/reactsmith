import ts from 'typescript';

function lineIndent(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/**
 * Inserts an item (given as lines) at the end of an object or array literal,
 * matching the indentation of the existing items and their trailing comma.
 */
export function insertListItem(
  text: string,
  sourceFile: ts.SourceFile,
  list: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
  lines: string[],
): string {
  const items: ts.NodeArray<ts.Node> = ts.isObjectLiteralExpression(list) ? list.properties : list.elements;
  if (items.length === 0) {
    const baseIndent = lineIndent(text, list.getStart(sourceFile));
    const indent = `${baseIndent}  `;
    const at = list.getStart(sourceFile) + 1;
    return `${text.slice(0, at)}\n${indent}${lines.join(`\n${indent}`)},\n${baseIndent}${text.slice(list.end - 1)}`;
  }

  const indent = lineIndent(text, items[0]!.getStart(sourceFile));
  const item = lines.join(`\n${indent}`);
  const last = items[items.length - 1]!;
  const comma = /^\s*,/.exec(text.slice(last.end));
  if (comma) {
    const at = last.end + comma[0].length;
    return `${text.slice(0, at)}\n${indent}${item},${text.slice(at)}`;
  }
  return `${text.slice(0, last.end)},\n${indent}${item}${text.slice(last.end)}`;
}

/** Adds an import statement after the last import, matching the file's use of semicolons, or first with a blank line after it. */
export function addImport(text: string, sourceFile: ts.SourceFile, statement: string): string {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const last = imports[imports.length - 1];
  const semicolon = last && !last.getText(sourceFile).endsWith(';') ? '' : ';';
  const line = `${statement}${semicolon}`;
  if (!last) return `${line}\n${/^\r?\n/.test(text) ? '' : '\n'}${text}`;
  return `${text.slice(0, last.end)}\n${line}${text.slice(last.end)}`;
}

/** Imports `name` from `specifier`: into an existing import of that module, or with a new import statement. */
export function addNamedImport(text: string, fileName: string, name: string, specifier: string): string {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const existing = sourceFile.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === specifier &&
      !statement.importClause?.isTypeOnly &&
      !!statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings),
  );
  const named = existing?.importClause?.namedBindings as ts.NamedImports | undefined;
  const last = named?.elements[named.elements.length - 1];
  if (last) return `${text.slice(0, last.getEnd())}, ${name}${text.slice(last.getEnd())}`;
  return addImport(text, sourceFile, `import { ${name} } from '${specifier}'`);
}
