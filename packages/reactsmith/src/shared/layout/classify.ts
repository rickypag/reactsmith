import { readFileSync } from 'node:fs';
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

/** Tells whether a JSX tag is a text component of the project. */
export function createTextClassifier(sourceFile: ts.SourceFile, file: string, root: string, config: ResolvedConfig): LayoutClassifier {
  return createElementClassifier(sourceFile, file, root, config, config.textComponents);
}

/** Tells whether a JSX tag is an interactive component of the project: a link or a button, holding text and elements. */
export function createInteractiveClassifier(sourceFile: ts.SourceFile, file: string, root: string, config: ResolvedConfig): LayoutClassifier {
  return createElementClassifier(sourceFile, file, root, config, config.interactiveComponents);
}

/** Tells whether other elements can be inserted into a JSX tag: layout and interactive elements. */
export function createContainerClassifier(sourceFile: ts.SourceFile, file: string, root: string, config: ResolvedConfig): LayoutClassifier {
  const isLayout = createLayoutClassifier(sourceFile, file, root, config);
  const isInteractive = createInteractiveClassifier(sourceFile, file, root, config);
  const takesChildren = createChildrenClassifier(sourceFile, file, root, config);
  return (tag) => isLayout(tag) || isInteractive(tag) || takesChildren(tag);
}

/** Whether the props of a component, in its file's text, declare children. */
export function declaresChildren(componentText: string, name: string): boolean {
  const componentFile = ts.createSourceFile(`${name}.tsx`, componentText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const props = componentFile.statements.find(
    (statement): statement is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(statement) && statement.name.text === `${name}Props`,
  );
  return !!props?.members.some((member) => member.name && ts.isIdentifier(member.name) && member.name.text === 'children');
}

/**
 * Tells whether a JSX tag is a component of the project that holds elements: its props declare children, which it
 * renders. The component is found through the file's import of it: its folder, or the barrel of its shared type.
 */
function createChildrenClassifier(sourceFile: ts.SourceFile, file: string, root: string, config: ResolvedConfig): LayoutClassifier {
  const srcDir = path.join(root, config.srcDir);
  const imports = importedNames(sourceFile);
  const cache = new Map<string, boolean>();
  const read = (candidate: string) => {
    try {
      return readFileSync(candidate, 'utf8');
    } catch {
      return undefined;
    }
  };
  return (tag) => {
    if (!ts.isIdentifier(tag) || !/^[A-Z]/.test(tag.text)) return false;
    const name = tag.text;
    const imported = imports.get(name);
    const base = imported ? specifierPath(imported.source, file, srcDir, config.alias)?.base : undefined;
    // A package's component (Suspense, next-intl's Link) has no file to read: one written around elements takes them,
    // since the code compiles. Its types aren't read here, where every tree is built.
    if (!base) return isWrittenWithChildren(tag);
    if (cache.has(name)) return cache.get(name)!;
    // The component's folder, or a shared type whose barrel offers it: components/cards → components/cards/Card.
    const text = read(path.join(base, `${name}.tsx`)) ?? read(path.join(base, name, `${name}.tsx`));
    const result = text !== undefined && declaresChildren(text, imported!.imported === 'default' ? name : imported!.imported);
    cache.set(name, result);
    return result;
  };
}

/** Whether the tag opens an element with elements inside: `<Suspense>…</Suspense>`, not `<Image />`. */
function isWrittenWithChildren(tag: ts.JsxTagNameExpression): boolean {
  const opening = tag.parent;
  if (!ts.isJsxOpeningElement(opening) || !ts.isJsxElement(opening.parent)) return false;
  return opening.parent.children.some((child) => !(ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces));
}

/** Tells whether a JSX tag may hold text: text and interactive elements. */
export function createTextHolderClassifier(sourceFile: ts.SourceFile, file: string, root: string, config: ResolvedConfig): LayoutClassifier {
  const isText = createTextClassifier(sourceFile, file, root, config);
  const isInteractive = createInteractiveClassifier(sourceFile, file, root, config);
  return (tag) => isText(tag) || isInteractive(tag);
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
