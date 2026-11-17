import { readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';
import { moduleExports } from '../types/check.js';
import { componentTypes } from '../components/scope.js';
import { listFiles, toRelative } from '../files.js';
import { iconLookupError } from '../icons/library.js';
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

interface ProjectScope {
  /** What --from calls it: a feature, "app", or a type of shared components ("buttons"). */
  from: string;
  /** The folder holding its component folders. */
  componentsRel: string;
  /** Shared components are imported through the barrel of their type, from outside the type. */
  shared?: boolean;
}

/** The project's component folders a file can import, under the import rules: its feature's, the app's, the shared types. */
function projectScopes(config: ResolvedConfig, fileRel: string): ProjectScope[] {
  const { srcDir, folders, featureFolders, appFolders, imports } = config;
  const featuresRel = `${srcDir}/${folders.features}/`;
  const appRel = folders.app ? `${srcDir}/${folders.app}/` : undefined;
  const inFeature = fileRel.startsWith(featuresRel) ? fileRel.slice(featuresRel.length).split('/')[0] : undefined;
  const inApp = appRel !== undefined && fileRel.startsWith(appRel);

  const scopes: ProjectScope[] = [];
  if (inFeature && featureFolders.components) scopes.push({ from: inFeature, componentsRel: `${featuresRel}${inFeature}/${featureFolders.components}` });
  if (appRel && appFolders.components && (inApp || (inFeature ? imports.featuresImportApp : imports.sharedImportApp))) {
    scopes.push({ from: 'app', componentsRel: `${appRel}${appFolders.components}` });
  }
  if (folders.components) {
    for (const type of componentTypes(config)) scopes.push({ from: type, componentsRel: `${srcDir}/${folders.components}/${type}`, shared: true });
  }
  return scopes;
}

/** The names a barrel (index.ts) offers: `export { A } from …`, `export type { B } from …`, and its own exported declarations. */
function exportedNames(fileRel: string, text: string): Set<string> {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    }
    const exported = ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name) names.add(statement.name.text);
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
  }
  return names;
}

/** The folders directly in `dirRel`. */
async function subfolders(changes: ChangeSet, dirRel: string): Promise<string[]> {
  const entries = await readdir(changes.resolve(dirRel), { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

/** The specifier `fileRel` imports a module folder by: the alias for shared folders ("@/types"), else relative. */
function folderSpecifier(config: ResolvedConfig, fileRel: string, folderRel: string, shared: boolean): string {
  if (shared && config.alias && !fileRel.startsWith(`${folderRel}/`)) return `${config.alias}/${folderRel.slice(config.srcDir.length + 1)}`;
  return relativeImport(fileRel, `${folderRel}/index.ts`);
}

export interface TypeSources {
  /** Each type found in exactly one place, with the specifier to import it from. */
  found: Map<string, string>;
  /** Types several places offer: which one is meant can't be told. */
  ambiguous: Map<string, string[]>;
}

/**
 * Where the types an interface names come from, for a file at `fileRel`: what the file already imports, then the
 * modules of the project the file may import under the import rules (the components it can use, through their
 * index.ts or their type's barrel, and its feature's and the shared types/ folders), then the installed packages.
 * The same places, in the same order, as the components "element insert" finds.
 */
export async function findTypeSources(changes: ChangeSet, config: ResolvedConfig, fileRel: string, fileText: string, types: string[]): Promise<TypeSources> {
  const found = new Map<string, string>();
  const ambiguous = new Map<string, string[]>();
  if (types.length === 0) return { found, ambiguous };
  const candidates = new Map<string, string[]>(types.map((type) => [type, []]));
  const add = (type: string, specifier: string) => {
    const list = candidates.get(type)!;
    if (!list.includes(specifier)) list.push(specifier);
  };

  const pending = types.filter((type) => {
    const imported = existingImport(fileText, fileRel, type);
    if (imported !== undefined) found.set(type, imported);
    return imported === undefined;
  });

  // The components the file may use, by what their index.ts offers.
  for (const scope of projectScopes(config, fileRel)) {
    for (const folder of await subfolders(changes, scope.componentsRel)) {
      const folderRel = `${scope.componentsRel}/${folder}`;
      if (fileRel.startsWith(`${folderRel}/`)) continue;
      const barrel = await changes.read(`${folderRel}/index.ts`);
      if (barrel === undefined) continue;
      const offered = exportedNames(`${folderRel}/index.ts`, barrel);
      // From outside its type, a shared component comes from the type's barrel: '@/components/buttons'.
      const throughBarrel = scope.shared && !fileRel.startsWith(`${scope.componentsRel}/`);
      const specifier = throughBarrel ? folderSpecifier(config, fileRel, scope.componentsRel, true) : relativeImport(fileRel, `${folderRel}/index.ts`);
      for (const type of pending) if (offered.has(type)) add(type, specifier);
    }
  }
  // The types/ folders: the file's feature's, and the shared one.
  const { srcDir, folders, featureFolders } = config;
  const featuresRel = `${srcDir}/${folders.features}/`;
  const feature = fileRel.startsWith(featuresRel) ? fileRel.slice(featuresRel.length).split('/')[0] : undefined;
  const typeFolders = [
    ...(feature && featureFolders.types ? [{ rel: `${featuresRel}${feature}/${featureFolders.types}`, shared: false }] : []),
    ...(folders.types ? [{ rel: `${srcDir}/${folders.types}`, shared: true }] : []),
  ];
  for (const { rel, shared } of typeFolders) {
    const barrel = await changes.read(`${rel}/index.ts`);
    if (barrel === undefined || fileRel.startsWith(`${rel}/`)) continue;
    const offered = exportedNames(`${rel}/index.ts`, barrel);
    for (const type of pending) if (offered.has(type)) add(type, folderSpecifier(config, fileRel, rel, shared));
  }
  // The installed packages; the icon library only for names ending in "Icon", as for components.
  const packages = (await dependencies(changes)).filter((dependency) => dependency !== config.icons?.library || pending.some((type) => type.endsWith('Icon')));
  const unresolved = pending.filter((type) => candidates.get(type)!.length === 0);
  if (unresolved.length && packages.length) {
    for (const [specifier, exports] of moduleExports(changes.root, packages)) {
      for (const type of unresolved) {
        if (specifier === config.icons?.library && !type.endsWith('Icon')) continue;
        if (exports?.has(type)) add(type, specifier);
      }
    }
  }

  for (const type of pending) {
    const specifiers = candidates.get(type)!;
    if (specifiers.length === 1) found.set(type, specifiers[0]!);
    if (specifiers.length > 1) ambiguous.set(type, specifiers);
  }
  return { found, ambiguous };
}

export async function dependencies(changes: ChangeSet): Promise<string[]> {
  const text = await changes.read('package.json');
  if (!text) return [];
  try {
    return Object.keys((JSON.parse(text) as { dependencies?: Record<string, string> }).dependencies ?? {});
  } catch {
    return [];
  }
}

/**
 * The refusal for a component of the project that exists, but where the import rules keep it out of reach of
 * `fileRel`: the app's (features and shared code don't import the app, which sits above them), or another feature's
 * (features don't import each other). Undefined when there is no such component.
 */
async function outOfReach(changes: ChangeSet, config: ResolvedConfig, fileRel: string, name: string): Promise<IssueError | undefined> {
  const srcDir = path.join(changes.root, config.srcDir);
  const found = (await listFiles(srcDir))
    .map((file) => toRelative(changes.root, file))
    .filter((file) => file.endsWith(`/${name}/${name}.tsx`))
    .map((file) => path.posix.dirname(file));
  const folderRel = found[0];
  if (!folderRel) return undefined;
  const appRel = config.folders.app ? `${config.srcDir}/${config.folders.app}/` : undefined;
  const featuresRel = `${config.srcDir}/${config.folders.features}/`;
  const where = appRel && folderRel.startsWith(appRel) ? 'the app' : folderRel.startsWith(featuresRel) ? `the feature "${folderRel.slice(featuresRel.length).split('/')[0]}"` : folderRel;
  const why = where === 'the app'
    ? 'features and shared components don\'t import from the app, which sits above them'
    : 'features don\'t import each other\'s components';
  return lookupError(
    'element-source-out-of-reach',
    `"${name}" is a component of ${where} (${folderRel}), which ${fileRel} can't use: ${why}.`,
    `Make it a shared component, which every part can use: "component update ${name} --type <type>" (e.g. --type buttons). Or render it from the app and pass what it needs as props.`,
    fileRel,
  );
}

/**
 * Where the component `name`, inserted into `fileRel`, comes from: the file's own import of it; else a component
 * of the project the file may import, or a dependency exporting it. Exactly one must match, or --from says which.
 * The icon library is searched only for names ending in "Icon" (or when --from names it).
 */
export async function findComponentSource(changes: ChangeSet, config: ResolvedConfig, fileRel: string, fileText: string, name: string, from?: string): Promise<ComponentSource> {
  const imported = existingImport(fileText, fileRel, name);
  if (imported !== undefined) {
    const target = specifierPath(imported, path.join(changes.root, fileRel), path.join(changes.root, config.srcDir), config.alias);
    if (from !== undefined && !target && from !== imported) {
      throw lookupError('insert-name-taken', `${fileRel} already imports "${name}" from "${imported}".`, 'Leave out --from to use it, or rename one of them.', fileRel);
    }
    if (!target) return { specifier: imported, kind: 'package', from: imported, kindSource: imported, imported: true };
    let folderRel = toRelative(changes.root, target.base);
    // Imported through the barrel of a type of shared components: the component is a folder of the type.
    if (config.folders.components && folderRel.startsWith(`${config.srcDir}/${config.folders.components}/`) && folderRel.split('/').length === config.srcDir.split('/').length + 2) {
      folderRel = `${folderRel}/${name}`;
    }
    const kindSource = config.alias ? `${config.alias}/${folderRel.slice(config.srcDir.length + 1)}` : folderRel;
    return { specifier: imported, kind: 'project', from: from ?? imported, folderRel, kindSource, imported: true };
  }

  const candidates: ComponentSource[] = [];
  const scopes = projectScopes(config, fileRel);
  for (const scope of scopes) {
    if (from !== undefined && from !== scope.from && !(from === 'shared' && scope.shared)) continue;
    const folderRel = `${scope.componentsRel}/${name}`;
    if ((await changes.read(`${folderRel}/${name}.tsx`)) === undefined || (await changes.read(`${folderRel}/index.ts`)) === undefined) continue;
    const kindSource = config.alias ? `${config.alias}/${folderRel.slice(config.srcDir.length + 1)}` : folderRel;
    // From outside its type, a shared component comes from the type's barrel: '@/components/buttons'.
    const throughBarrel = scope.shared && !fileRel.startsWith(`${scope.componentsRel}/`);
    const specifier = !throughBarrel
      ? relativeImport(fileRel, `${folderRel}/index.ts`)
      : config.alias
        ? `${config.alias}/${scope.componentsRel.slice(config.srcDir.length + 1)}`
        : relativeImport(fileRel, `${scope.componentsRel}/index.ts`);
    candidates.push({ specifier, kind: 'project', from: scope.from, folderRel, kindSource, imported: false });
  }

  const isProjectScope = from !== undefined && (from === 'shared' || scopes.some((scope) => scope.from === from));
  if (!isProjectScope) {
    // Icons are named "…Icon": only those names are looked up in the icon library.
    const packages = from !== undefined ? [from] : (await dependencies(changes)).filter((dependency) => dependency !== config.icons?.library || name.endsWith('Icon'));
    if (packages.length) {
      for (const [specifier, exports] of moduleExports(changes.root, packages)) {
        if (exports?.has(name)) candidates.push({ specifier, kind: 'package', from: specifier, kindSource: specifier, imported: false });
      }
    }
  }

  if (candidates.length === 0) {
    const icon = from === undefined ? iconLookupError(changes.root, config, name) : undefined;
    if (icon) throw icon;
    const hidden = await outOfReach(changes, config, fileRel, name);
    if (hidden) throw hidden;
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
