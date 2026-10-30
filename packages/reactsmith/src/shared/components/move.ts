import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { planBarrelExports } from '../code/barrel.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { findSpecifiers, isCodeFile, relativeImport, specifierPath, type SpecifierPath } from '../imports/specifiers.js';
import { IssueError, type Issue } from '../issues.js';
import { importIssues } from '../structure/imports.js';
import { barrelExportsOf, importersOf, projectImports } from './importers.js';
import { projectComponents, type ProjectComponent } from './registry.js';
import { componentScope, type ComponentOwner } from './scope.js';
import { applyEdits, parseTsx } from './usages.js';

function moveError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

const inside = (rel: string, folderRel: string) => rel === folderRel || rel.startsWith(`${folderRel}/`);

/** Joins named imports of the same path into the first one: a move can point two imports at one barrel. */
function mergeImports(fileRel: string, text: string): string {
  const sourceFile = parseTsx(fileRel, text);
  const groups = new Map<string, ts.ImportDeclaration[]>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const key = `${clause.isTypeOnly ? 'type ' : ''}${statement.moduleSpecifier.text}`;
    groups.set(key, [...(groups.get(key) ?? []), statement]);
  }
  const edits: [number, number, string][] = [];
  for (const [first, ...rest] of groups.values()) {
    if (!rest.length) continue;
    const names = [first!, ...rest].flatMap((statement) => (statement.importClause!.namedBindings as ts.NamedImports).elements.map((element) => element.getText(sourceFile)));
    const bindings = first!.importClause!.namedBindings!;
    edits.push([bindings.getStart(sourceFile), bindings.getEnd(), `{ ${[...new Set(names)].join(', ')} }`]);
    for (const statement of rest) edits.push([statement.getFullStart(), statement.getEnd(), '']);
  }
  return applyEdits(text, edits);
}

/** The barrel of a shared type a component folder is in ("src/components/cards/index.ts"), if it is a shared component. */
function typeBarrelOf(config: ResolvedConfig, folderRel: string): string | undefined {
  const shared = !!config.folders.components && folderRel.startsWith(`${config.srcDir}/${config.folders.components}/`);
  return shared ? `${path.posix.dirname(folderRel)}/index.ts` : undefined;
}

/**
 * The components that move with `component`: itself, and the components next to it (same owner) that only the
 * group uses, again and again: Sidebar takes SidebarGroup, which takes SidebarLink. One that anything else uses stays.
 */
async function componentGroup(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent): Promise<ProjectComponent[]> {
  const ownerDir = path.posix.dirname(component.folderRel);
  const siblings = (await projectComponents(changes.root, config)).filter((other) => path.posix.dirname(other.folderRel) === ownerDir && other.folderRel !== component.folderRel);
  const imports = await projectImports(changes.root, config, (fileRel) => changes.read(fileRel));
  const barrelRel = typeBarrelOf(config, component.folderRel);
  const barrelText = barrelRel ? await changes.read(barrelRel) : undefined;
  const group = [component];
  for (let grew = true; grew; ) {
    grew = false;
    for (const candidate of siblings) {
      if (group.includes(candidate)) continue;
      const names = barrelText === undefined ? [] : barrelExportsOf(barrelRel!, barrelText, candidate.name);
      const users = importersOf(imports, changes.root, candidate, names);
      if (users.length && users.every((user) => group.some((member) => inside(user, member.folderRel)))) {
        group.push(candidate);
        grew = true;
      }
    }
  }
  return group;
}

/**
 * Plans moving a component to another owner (a feature, the app, a type of shared components), with the components
 * only it uses. Every import of the moved files is rewritten, theirs and their usages', and the barrels of shared
 * types follow. Refused when an import would then break the import rules, e.g. a feature using an app component.
 */
export async function planComponentMove(changes: ChangeSet, config: ResolvedConfig, component: ProjectComponent, owner: ComponentOwner): Promise<ProjectComponent> {
  const scope = componentScope(config, owner);
  if (path.posix.dirname(component.folderRel) === scope.componentsRel) {
    throw moveError('component-move-same', `"${component.name}" is already in ${scope.label}.`, 'Pass another owner: --feature <name>, --app or --type <type>.', component.folderRel);
  }
  if ('feature' in owner && (await listFiles(path.join(changes.root, scope.scopeRel)).catch(() => [])).length === 0) {
    throw moveError('feature-missing', `There is no feature "${owner.feature}".`, `Create it first: "feature create ${owner.feature}".`);
  }

  const group = await componentGroup(changes, config, component);
  const moves = new Map(group.map((member) => [member.folderRel, `${scope.componentsRel}/${member.name}`]));
  const mapped = (rel: string) => {
    for (const [from, to] of moves) if (inside(rel, from)) return `${to}${rel.slice(from.length)}`;
    return undefined;
  };
  const srcAbs = path.join(changes.root, config.srcDir);
  const alias = config.alias;
  const componentsRoot = config.folders.components ? `${config.srcDir}/${config.folders.components}` : undefined;

  /** The folder code is written in: a feature, the app, or a type of shared components; imports inside it stay relative. */
  const scopeOf = (rel: string) => {
    const parts = rel.split('/');
    if (parts[1] === config.folders.features) return parts.slice(0, 3).join('/');
    if (componentsRoot && inside(rel, componentsRoot)) return parts.slice(0, 3).join('/');
    return parts.slice(0, 2).join('/');
  };
  /** How `fromRel` imports `targetRel`: a shared component through its type's barrel from outside the type, else by path. */
  const specifierFor = (fromRel: string, targetRel: string, original: SpecifierPath) => {
    let target = targetRel;
    const typeFolder = path.posix.dirname(targetRel);
    if (componentsRoot && path.posix.dirname(typeFolder) === componentsRoot && !inside(fromRel, typeFolder)) target = typeFolder;
    const sameScope = scopeOf(fromRel) === scopeOf(target);
    const bare = !sameScope && alias ? `${alias}/${target.slice(config.srcDir.length + 1)}` : relativeImport(fromRel, target);
    return `${bare}${original.suffix}`;
  };

  // What the barrels of shared types offer from the moved components: Card, CardProps.
  const barrelNames = new Map<string, ProjectComponent>();
  const oldBarrels = new Set<string>();
  for (const member of group) {
    const barrelRel = typeBarrelOf(config, member.folderRel);
    const text = barrelRel ? await changes.read(barrelRel) : undefined;
    if (!barrelRel || text === undefined) continue;
    oldBarrels.add(barrelRel);
    for (const name of barrelExportsOf(barrelRel, text, member.name)) barrelNames.set(`${path.posix.dirname(member.folderRel)}:${name}`, member);
  }

  const written = new Map<string, { fileRel: string; text: string; usage: boolean }>();
  for (const file of (await listFiles(srcAbs)).filter(isCodeFile)) {
    const fileRel = toRelative(changes.root, file);
    if (oldBarrels.has(fileRel)) continue;
    const text = await changes.read(fileRel);
    if (text === undefined) continue;
    const movedTo = mapped(fileRel);
    const newRel = movedTo ?? fileRel;
    const sourceFile = parseTsx(fileRel, text);
    const edits: [number, number, string][] = [];
    for (const statement of sourceFile.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const literal = statement.moduleSpecifier;
      const original = specifierPath(literal.text, file, srcAbs, alias);
      if (!original) continue;
      const baseRel = toRelative(changes.root, original.base);
      const target = mapped(baseRel);
      const replaceSpecifier = (value: string) => {
        if (value !== literal.text) edits.push([literal.getStart(sourceFile) + 1, literal.getEnd() - 1, value]);
      };

      if (target !== undefined) {
        replaceSpecifier(specifierFor(newRel, target, original));
        continue;
      }
      // Through the barrel of a shared type: the moved names get their own import, the others stay.
      const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : statement.exportClause;
      const typeNames = (name: string) => barrelNames.get(`${baseRel}:${name}`);
      if (bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) {
        const elements = [...bindings.elements] as (ts.ImportSpecifier | ts.ExportSpecifier)[];
        const moving = elements.filter((element) => typeNames((element.propertyName ?? element.name).text));
        if (moving.length) {
          const keyword = ts.isImportDeclaration(statement) ? 'import' : 'export';
          const typeOnly = ts.isImportDeclaration(statement) ? !!statement.importClause?.isTypeOnly : statement.isTypeOnly;
          const quote = sourceFile.text[literal.getStart(sourceFile)];
          const semicolon = statement.getText(sourceFile).endsWith(';') ? ';' : '';
          const line = (list: typeof elements, value: string) => `${keyword}${typeOnly ? ' type' : ''} { ${list.map((element) => element.getText(sourceFile)).join(', ')} } from ${quote}${value}${quote}${semicolon}`;
          const kept = elements.filter((element) => !moving.includes(element));
          const bySpecifier = new Map<string, typeof elements>();
          for (const element of moving) {
            const member = typeNames((element.propertyName ?? element.name).text)!;
            const value = specifierFor(newRel, moves.get(member.folderRel)!, original);
            bySpecifier.set(value, [...(bySpecifier.get(value) ?? []), element]);
          }
          const lines = [...(kept.length ? [line(kept, literal.text)] : []), ...[...bySpecifier].map(([value, list]) => line(list, value))];
          edits.push([statement.getStart(sourceFile), statement.getEnd(), lines.join('\n')]);
          continue;
        }
      } else if (bindings && barrelNames.size && [...barrelNames.keys()].some((key) => key.startsWith(`${baseRel}:`))) {
        throw moveError('move-namespace-import', `${fileRel} imports everything from "${literal.text}", which offers "${component.name}".`, 'Import the names it uses instead, then move the component.', fileRel);
      }
      // A moved file's import of something that stays: the same file, from its new place.
      if (movedTo !== undefined && original.style === 'relative') replaceSpecifier(specifierFor(newRel, baseRel, original));
    }
    if (movedTo !== undefined || edits.length) written.set(fileRel, { fileRel: newRel, text: edits.length ? mergeImports(newRel, applyEdits(text, edits)) : text, usage: movedTo === undefined });
  }

  // The import rules hold after the move, or nothing moves.
  const broken: Issue[] = [];
  for (const { fileRel, text } of written.values()) {
    const fileAbs = changes.resolve(fileRel);
    for (const { value } of findSpecifiers(text)) {
      const resolved = specifierPath(value, fileAbs, srcAbs, alias);
      if (!resolved) continue;
      for (const issue of importIssues(config, toRelative(srcAbs, fileAbs), fileRel, value, toRelative(srcAbs, resolved.base))) {
        if (issue.severity !== 'error') continue;
        broken.push({ ...issue, code: 'move-breaks-imports', message: `After moving "${component.name}" to ${scope.label}: ${issue.message} (${issue.code})` });
      }
    }
  }
  if (broken.length) throw new IssueError(broken);

  // Moves, then the barrels: the old ones lose the moved components, a shared type's barrel offers them.
  for (const member of group) {
    const to = moves.get(member.folderRel)!;
    for (const fileRel of (await listFiles(path.join(changes.root, member.folderRel))).map((file) => toRelative(changes.root, file))) {
      const target = `${to}${fileRel.slice(member.folderRel.length)}`;
      changes.move({ from: changes.resolve(fileRel), to: changes.resolve(target) });
      const pending = written.get(fileRel);
      if (pending) changes.writeSilently(changes.resolve(target), pending.text);
    }
    changes.removeIfEmpty(changes.resolve(member.folderRel));
  }
  for (const { fileRel, text, usage } of written.values()) {
    if (usage) changes.write(fileRel, text, { type: 'update', message: `imports ${group.map((member) => `"${member.name}"`).join(', ')} from ${scope.label}` });
  }
  for (const barrelRel of oldBarrels) {
    const text = (await changes.read(barrelRel))!;
    const barrel = parseTsx(barrelRel, text);
    const kept = barrel.statements.filter((statement) => !(ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) && group.some((member) => statement.moduleSpecifier!.getText(barrel).slice(1, -1) === `./${member.name}` && path.posix.dirname(member.folderRel) === path.posix.dirname(barrelRel))));
    if (kept.length === 0) changes.delete(barrelRel, 'the barrel of its type, now empty');
    else if (kept.length < barrel.statements.length) changes.write(barrelRel, `${kept.map((statement) => statement.getText(barrel)).join('\n')}\n`, { type: 'update', message: `no longer offers ${group.map((member) => `"${member.name}"`).join(', ')}` });
  }
  if ('type' in owner) {
    const lines: string[] = [];
    for (const member of group) {
      const code = (await changes.read(`${moves.get(member.folderRel)!}/${member.name}.tsx`)) ?? '';
      lines.push(`export { ${member.name} } from './${member.name}';`);
      if (new RegExp(`export\\s+(interface|type)\\s+${member.name}Props\\b`).test(code)) lines.push(`export type { ${member.name}Props } from './${member.name}';`);
    }
    await planBarrelExports(changes, `${scope.componentsRel}/index.ts`, lines);
  }
  for (const member of group) changes.report({ type: 'move', path: member.folderRel, message: `→ ${moves.get(member.folderRel)}${member === component ? '' : ` (only "${component.name}" uses it)`}` });
  return { name: component.name, folderRel: moves.get(component.folderRel)! };
}
