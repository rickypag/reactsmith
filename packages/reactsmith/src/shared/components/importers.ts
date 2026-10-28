import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { isCodeFile, specifierPath } from '../imports/specifiers.js';
import type { ProjectComponent } from './registry.js';
import { parseTsx } from './usages.js';

/** An import (or re-export) of a project file, resolved. */
export interface ProjectImport {
  fileRel: string;
  /** The imported path without extension, absolute: a folder (its index.ts) or a file. */
  base: string;
  /** The names it takes, type imports included; undefined for `* as` and `export *`, which take everything. */
  names: string[] | undefined;
}

/** Every import of a project file by the code files of srcDir, read through `read` (planned changes included). */
export async function projectImports(root: string, config: ResolvedConfig, read: (fileRel: string) => Promise<string | undefined>): Promise<ProjectImport[]> {
  const srcAbs = path.join(root, config.srcDir);
  const found: ProjectImport[] = [];
  for (const file of (await listFiles(srcAbs)).filter(isCodeFile)) {
    const fileRel = toRelative(root, file);
    const text = await read(fileRel);
    if (text === undefined) continue;
    for (const statement of parseTsx(fileRel, text).statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const base = specifierPath(statement.moduleSpecifier.text, file, srcAbs, config.alias)?.base;
      if (!base) continue;
      const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : statement.exportClause;
      const names = !bindings || ts.isNamespaceImport(bindings) || ts.isNamespaceExport(bindings) ? undefined : bindings.elements.map((element) => (element.propertyName ?? element.name).text);
      const defaultName = ts.isImportDeclaration(statement) ? statement.importClause?.name?.text : undefined;
      found.push({ fileRel, base, names: names === undefined && bindings === undefined && defaultName ? ['default'] : names });
    }
  }
  return found;
}

/** The names the barrel of a shared type re-exports from one of its components (`./Card`): Card, CardProps. */
export function barrelExportsOf(barrelRel: string, barrelText: string, name: string): string[] {
  return parseTsx(barrelRel, barrelText).statements.flatMap((statement) =>
    ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === `./${name}` && statement.exportClause && ts.isNamedExports(statement.exportClause)
      ? statement.exportClause.elements.map((element) => element.name.text)
      : [],
  );
}

/**
 * The files outside a component's folder that import from it: its folder or anything in it, or, through the barrel
 * of its shared type, one of `barrelNames` (what the barrel offers from it). Its type's barrel itself is not one.
 */
export function importersOf(imports: ProjectImport[], root: string, component: ProjectComponent, barrelNames: string[]): string[] {
  const folderAbs = path.join(root, component.folderRel);
  const typeFolderAbs = path.dirname(folderAbs);
  const barrelRel = `${path.posix.dirname(component.folderRel)}/index.ts`;
  const files = imports
    .filter(({ fileRel, base, names }) => {
      if (fileRel.startsWith(`${component.folderRel}/`) || fileRel === barrelRel) return false;
      if (base === folderAbs || base.startsWith(`${folderAbs}${path.sep}`)) return true;
      return base === typeFolderAbs && barrelNames.length > 0 && (names === undefined || names.some((name) => barrelNames.includes(name)));
    })
    .map(({ fileRel }) => fileRel);
  return [...new Set(files)];
}
