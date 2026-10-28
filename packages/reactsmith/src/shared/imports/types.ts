import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { moduleExports } from '../types/check.js';
import { dependencies } from './lookup.js';

/**
 * The installed package each type comes from: "LucideIcon" → "lucide-react". A type that no package exports,
 * or that several do, is left out: it stays for the dev to define or import.
 */
export async function packageTypes(changes: ChangeSet, types: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string[]>();
  if (types.length === 0) return new Map();
  const packages = await dependencies(changes);
  for (const [specifier, exports] of moduleExports(changes.root, packages)) {
    for (const type of types) if (exports?.has(type)) found.set(type, [...(found.get(type) ?? []), specifier]);
  }
  return new Map([...found].filter(([, specifiers]) => specifiers.length === 1).map(([type, [specifier]]) => [type, specifier!]));
}

/** `import type { A, B } from 'pkg';` for each package of `types`. */
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
