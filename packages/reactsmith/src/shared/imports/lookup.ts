import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { moduleExports } from '../types/check.js';
import { toRelative } from '../files.js';
import { relativeImport, specifierPath } from './specifiers.js';

/** Where a component is imported from. */
export interface ComponentSource {
  /** The import specifier, as the file will write it: "react-router", "../NavMenu". */
  specifier: string;
  kind: 'project' | 'package';
  /** For messages and --from: "app", "docs" (a feature), "shared", or the package name. */
  from: string;
  /** For a component of the project: its folder, relative to the project root. */
  folderRel?: string;
  /** The source to look the component up in the config's element maps: the package, or the folder's alias path. */
  kindSource: string;
  /** Whether the file already imports it. */
  imported: boolean;
}

function lookupError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/** The import of `name` in a file, if it has one. */
function existingImport(text: string, fileRel: string, name: string): string | undefined {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    const named = bindings && ts.isNamedImports(bindings) && bindings.elements.some((element) => element.name.text === name);
    if (clause?.name?.text === name || named) return statement.moduleSpecifier.text;
  }
  return undefined;
}

/** The project's component folders a file can import, under the import rules: its feature's, the app's, the shared ones. */
function projectScopes(config: ResolvedConfig, fileRel: string): { from: string; componentsRel: string }[] {
  const { srcDir, folders, featureFolders, appFolders, imports } = config;
  const featuresRel = `${srcDir}/${folders.features}/`;
  const appRel = folders.app ? `${srcDir}/${folders.app}/` : undefined;
  const inFeature = fileRel.startsWith(featuresRel) ? fileRel.slice(featuresRel.length).split('/')[0] : undefined;
  const inApp = appRel !== undefined && fileRel.startsWith(appRel);

  const scopes: { from: string; componentsRel: string }[] = [];
  if (inFeature && featureFolders.components) scopes.push({ from: inFeature, componentsRel: `${featuresRel}${inFeature}/${featureFolders.components}` });
  if (appRel && appFolders.components && (inApp || (inFeature ? imports.featuresImportApp : imports.sharedImportApp))) {
    scopes.push({ from: 'app', componentsRel: `${appRel}${appFolders.components}` });
  }
  if (folders.components) scopes.push({ from: 'shared', componentsRel: `${srcDir}/${folders.components}` });
  return scopes;
}

async function dependencies(changes: ChangeSet): Promise<string[]> {
  const text = await changes.read('package.json');
  if (!text) return [];
  try {
    return Object.keys((JSON.parse(text) as { dependencies?: Record<string, string> }).dependencies ?? {});
  } catch {
    return [];
  }
}

/**
 * Where the component `name`, inserted into `fileRel`, comes from: the file's own import of it; else a component
 * of the project the file may import, or a dependency exporting it. Exactly one must match, or --from says which.
 * The icon library is left out of the search (icons have "icon insert"), unless --from names it.
 */
export async function findComponentSource(changes: ChangeSet, config: ResolvedConfig, fileRel: string, fileText: string, name: string, from?: string): Promise<ComponentSource> {
  const imported = existingImport(fileText, fileRel, name);
  if (imported !== undefined) {
    const target = specifierPath(imported, path.join(changes.root, fileRel), path.join(changes.root, config.srcDir), config.alias);
    if (from !== undefined && !target && from !== imported) {
      throw lookupError('insert-name-taken', `${fileRel} already imports "${name}" from "${imported}".`, 'Leave out --from to use it, or rename one of them.', fileRel);
    }
    if (!target) return { specifier: imported, kind: 'package', from: imported, kindSource: imported, imported: true };
    const folderRel = toRelative(changes.root, target.base);
    const kindSource = config.alias ? `${config.alias}/${folderRel.slice(config.srcDir.length + 1)}` : folderRel;
    return { specifier: imported, kind: 'project', from: from ?? imported, folderRel, kindSource, imported: true };
  }

  const candidates: ComponentSource[] = [];
  const scopes = projectScopes(config, fileRel);
  for (const scope of scopes) {
    if (from !== undefined && from !== scope.from) continue;
    const folderRel = `${scope.componentsRel}/${name}`;
    if ((await changes.read(`${folderRel}/${name}.tsx`)) === undefined || (await changes.read(`${folderRel}/index.ts`)) === undefined) continue;
    const kindSource = config.alias ? `${config.alias}/${folderRel.slice(config.srcDir.length + 1)}` : folderRel;
    candidates.push({ specifier: relativeImport(fileRel, `${folderRel}/index.ts`), kind: 'project', from: scope.from, folderRel, kindSource, imported: false });
  }

  const isProjectScope = from !== undefined && scopes.some((scope) => scope.from === from);
  if (!isProjectScope) {
    const packages = from !== undefined ? [from] : (await dependencies(changes)).filter((dependency) => dependency !== config.icons?.library);
    if (packages.length) {
      for (const [specifier, exports] of moduleExports(changes.root, packages)) {
        if (exports?.has(name)) candidates.push({ specifier, kind: 'package', from: specifier, kindSource: specifier, imported: false });
      }
    }
  }

  if (candidates.length === 0) {
    throw from !== undefined
      ? lookupError('element-source-missing', `"${name}" is not exported by "${from}".`, `Check the name and --from: "app", a feature, "shared", or an installed package.`, fileRel)
      : lookupError(
          'element-source-missing',
          `"${name}" is neither a component the file can use nor exported by a dependency.`,
          'Create it with "component create", install the package that has it, or pass --from.',
          fileRel,
        );
  }
  if (candidates.length > 1) {
    const list = candidates.map((candidate) => candidate.from).join(', ');
    throw lookupError('element-source-ambiguous', `"${name}" is in ${list}.`, `Say which with --from, e.g. --from ${candidates[0]!.from}.`, fileRel);
  }
  const [source] = candidates;
  if (source!.folderRel && fileRel.startsWith(`${source!.folderRel}/`)) {
    throw lookupError('insert-into-itself', `${fileRel} belongs to "${name}" itself, which would render itself forever.`, 'Choose an element of another component or view.', fileRel);
  }
  return source!;
}
