import path from 'node:path';
import ts from 'typescript';
import { HTML_SOURCE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { specifierPath } from '../imports/specifiers.js';

/** How a local name was imported: `import { Stack as S }` gives S → { source, imported: "Stack" }. */
interface ImportedName {
  source: string;
  /** The exported name, "default", or "*" for a namespace import. */
  imported: string;
}

/** Tells whether a JSX tag is a layout component of the project, given the file's imports. */
export type LayoutClassifier = (tag: ts.JsxTagNameExpression) => boolean;

function importedNames(sourceFile: ts.SourceFile): Map<string, ImportedName> {
  const names = new Map<string, ImportedName>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const source = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) names.set(clause.name.text, { source, imported: 'default' });
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) names.set(bindings.name.text, { source, imported: '*' });
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        names.set(element.name.text, { source, imported: (element.propertyName ?? element.name).text });
      }
    }
  }
  return names;
}

/**
 * A classifier for the JSX in `sourceFile` (at absolute path `file`). HTML elements are matched by tag.
 * Components count only when imported from their configured source, by name ("@mui/material"),
 * by subpath ("@mui/material/Stack") or through a namespace (`<M.Stack>`). Configured alias paths
 * ("@/components/layout") also match relative imports of the same folder.
 */
export function createLayoutClassifier(sourceFile: ts.SourceFile, file: string, root: string, config: ResolvedConfig): LayoutClassifier {
  return createElementClassifier(sourceFile, file, root, config, config.layoutComponents);
}

/** Tells whether a JSX tag is a text component of the project: the only elements that may hold text. */
export function createTextClassifier(sourceFile: ts.SourceFile, file: string, root: string, config: ResolvedConfig): LayoutClassifier {
  return createElementClassifier(sourceFile, file, root, config, config.textComponents);
}

/** A classifier for `elements`, a map of import sources to names such as "layoutComponents". */
export function createElementClassifier(
  sourceFile: ts.SourceFile,
  file: string,
  root: string,
  config: ResolvedConfig,
  elements: Record<string, readonly string[]>,
): LayoutClassifier {
  const srcDir = path.join(root, config.srcDir);
  const imports = importedNames(sourceFile);
  const html = new Set(elements[HTML_SOURCE] ?? []);
  const sources = Object.entries(elements)
    .filter(([source]) => source !== HTML_SOURCE)
    .map(([source, names]) => ({ source, names: new Set(names), base: specifierPath(source, file, srcDir, config.alias)?.base }));

  /** The configured source an import comes from, and the subpath below it: "Stack" for "@mui/material/Stack". */
  function match(specifier: string): { names: Set<string>; subpath?: string } | undefined {
    const base = specifierPath(specifier, file, srcDir, config.alias)?.base;
    for (const entry of sources) {
      const [from, prefix] = entry.base && base ? [base, entry.base] : [specifier, entry.source];
      if (from === prefix) return { names: entry.names };
      const separator = entry.base && base ? path.sep : '/';
      if (from.startsWith(prefix + separator)) return { names: entry.names, subpath: from.slice(prefix.length + 1) };
    }
    return undefined;
  }

  function isLayoutComponent(local: string, member?: string): boolean {
    const imported = imports.get(local);
    if (!imported) return false;
    const source = match(imported.source);
    if (!source) return false;
    if (member !== undefined) return imported.imported === '*' && source.names.has(member);
    // A default import from a subpath takes the subpath's last segment as its name: "@mui/material/Stack".
    const name = imported.imported === 'default' ? source.subpath?.split(/[\/]/).pop() : imported.imported;
    return name !== undefined && source.names.has(name);
  }

  return (tag) => {
    if (ts.isIdentifier(tag)) {
      return /^[a-z]/.test(tag.text) ? html.has(tag.text) : isLayoutComponent(tag.text);
    }
    if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.expression)) {
      return isLayoutComponent(tag.expression.text, tag.name.text);
    }
    return false;
  };
}
