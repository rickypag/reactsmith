import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { isCodeFile, specifierPath } from '../imports/specifiers.js';

/** A file that imports a component of the project, and the name it uses for it. */
export interface ComponentUsage {
  fileRel: string;
  /** The local name: "Card", or "C" for `import { Card as C }`. */
  localName: string;
  /** Whether the import renames it: `import { Card as C }`. */
  aliased: boolean;
  /** The import's specifier: "../Card", "@/components/cards". */
  specifier: string;
}

export const parseTsx = (fileRel: string, text: string) => ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/**
 * The files importing a component: through its folder ("../Card"), or through the barrel of its shared type
 * ("@/components/cards"). Files of the component's own folder are not usages.
 */
export async function componentUsages(changes: ChangeSet, config: ResolvedConfig, name: string, folderRel: string): Promise<ComponentUsage[]> {
  const srcAbs = path.join(changes.root, config.srcDir);
  const folderAbs = path.join(changes.root, folderRel);
  const typeFolderAbs = path.dirname(folderAbs);
  const isShared = !!config.folders.components && folderRel.startsWith(`${config.srcDir}/${config.folders.components}/`);
  const usages: ComponentUsage[] = [];

  for (const file of (await listFiles(srcAbs)).filter(isCodeFile)) {
    const fileRel = toRelative(changes.root, file);
    if (fileRel.startsWith(`${folderRel}/`)) continue;
    const text = await changes.read(fileRel);
    if (!text?.includes(name)) continue;
    const sourceFile = parseTsx(fileRel, text);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
      const base = specifierPath(statement.moduleSpecifier.text, file, srcAbs, config.alias)?.base;
      if (!base || !(base === folderAbs || (isShared && base === typeFolderAbs))) continue;
      const bindings = statement.importClause?.namedBindings;
      const element = bindings && ts.isNamedImports(bindings) ? bindings.elements.find((candidate) => (candidate.propertyName ?? candidate.name).text === name) : undefined;
      if (element) usages.push({ fileRel, localName: element.name.text, aliased: !!element.propertyName, specifier: statement.moduleSpecifier.text });
    }
  }
  return usages;
}

/** The JSX elements of a file whose tag is `localName`: the places a component is used. */
export function usageElements(sourceFile: ts.SourceFile, localName: string): (ts.JsxElement | ts.JsxSelfClosingElement)[] {
  const found: (ts.JsxElement | ts.JsxSelfClosingElement)[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === localName) found.push(node);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sourceFile) === localName) found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** The opening tag of a JSX element. */
export function openingOf(element: ts.JsxElement | ts.JsxSelfClosingElement): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

/** Applies text replacements, given as [start, end, text], from the last to the first so the offsets stay valid. */
export function applyEdits(text: string, edits: [number, number, string][]): string {
  return [...edits].sort((a, b) => b[0] - a[0]).reduce((updated, [start, end, replacement]) => `${updated.slice(0, start)}${replacement}${updated.slice(end)}`, text);
}
