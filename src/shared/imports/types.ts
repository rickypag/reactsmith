import ts from 'typescript';

/** `import type { A, B } from '…';` for each specifier of `types`: a package, or a module of the project. */
export function typeImports(types: Map<string, string>): string[] {
  const bySpecifier = new Map<string, string[]>();
  for (const [type, specifier] of types) bySpecifier.set(specifier, [...(bySpecifier.get(specifier) ?? []), type]);
  return [...bySpecifier].map(([specifier, names]) => `import type { ${names.sort().join(', ')} } from '${specifier}';`);
}

/** The types a file already knows: the names it imports, and the types and interfaces it declares. */
export function knownTypes(text: string): Set<string> {
  const sourceFile = ts.createSourceFile('file.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      if (clause.name) names.add(clause.name.text);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) for (const element of clause.namedBindings.elements) names.add(element.name.text);
    }
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name) names.add(statement.name.text);
  }
  return names;
}
