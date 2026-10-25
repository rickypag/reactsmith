import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { CONFIG_FILE, ICON_LIBRARIES, KNOWN_ICON_LIBRARIES } from '../config/defaults.js';
import type { IconLibrary, IconsConfig, ResolvedConfig } from '../config/types.js';
import { dependencyMajor, detectPackageManager, installCommand } from '../dependencies.js';
import { listFiles } from '../files.js';
import { findSpecifiers, isCodeFile } from '../imports/specifiers.js';
import { IssueError, type Issue } from '../issues.js';

function iconError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

/**
 * The icons settings to save in the config: the supported icon library the project depends on.
 * Undefined when the config already sets them, or when none is installed (icons stay disabled).
 */
export async function planIconsDetection(changes: ChangeSet): Promise<IconsConfig | undefined> {
  const text = await changes.read(CONFIG_FILE);
  const raw: unknown = text === undefined ? undefined : parse(text);
  if (typeof raw === 'object' && raw !== null && 'icons' in raw) return undefined;
  for (const library of ICON_LIBRARIES) {
    if ((await dependencyMajor(changes.root, library)) !== undefined) return { library };
  }
  return undefined;
}

/** The icon library of the project, or an error saying how to set one up. */
export async function requireIcons(root: string, config: ResolvedConfig): Promise<IconLibrary> {
  if (config.icons) return config.icons.library;
  const install = installCommand(await detectPackageManager(root), ICON_LIBRARIES[0]);
  throw iconError('icons-not-configured', 'No icon library is configured.', `Run "${install}", then "reactsmith init" to record it.`, CONFIG_FILE);
}

/** Lucide exports each icon three times: "Github", "GithubIcon" and "LucideGithub". Only the first is listed. */
function isIconName(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name) && !name.endsWith('Icon') && !name.startsWith('Lucide') && name !== 'Icon';
}

/** The icons the installed library exports, loaded from the project's own node_modules. */
export function loadIconNames(root: string, library: IconLibrary): Set<string> {
  let exports: Record<string, unknown>;
  try {
    exports = createRequire(path.join(root, 'package.json'))(library) as Record<string, unknown>;
  } catch {
    throw iconError('icons-not-installed', `The icon library "${library}" is configured but not installed.`, `Install it, e.g. "npm install ${library}".`, 'package.json');
  }
  return new Set(Object.keys(exports).filter(isIconName));
}

/** "arrow-right", "arrow right", "ArrowRightIcon" or "LucideArrowRight" → "ArrowRight". */
export function iconComponentName(input: string): string {
  const pascal = input
    .trim()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
  return pascal.replace(/^Lucide(?=[A-Z])/, '').replace(/(?<=.)Icon$/, '');
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** The icon's component name, or an error suggesting the closest names. */
export function resolveIconName(input: string, names: Set<string>, library: IconLibrary): string {
  const name = iconComponentName(input);
  if (names.has(name)) return name;
  const lower = name.toLowerCase();
  // About one typo every three letters: "arow-right" finds ArrowRight, "github" does not find Citrus.
  const tolerance = Math.max(1, Math.floor(lower.length / 3));
  const close = [...names]
    .map((candidate) => ({ candidate, score: candidate.toLowerCase().startsWith(lower) ? 0 : distance(lower, candidate.toLowerCase()) }))
    .filter(({ score }) => score <= tolerance)
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, 5)
    .map(({ candidate }) => candidate);
  throw iconError(
    'icon-not-found',
    `"${input}" is not an icon of ${library}.`,
    close.length ? `Did you mean ${close.join(', ')}?` : 'Look it up on the library\'s website, e.g. https://lucide.dev/icons.',
  );
}

/** Imports from icon libraries other than the configured one: a project uses a single icon library. */
export async function checkIconLibraries(root: string, config: ResolvedConfig, issues: Issue[]): Promise<void> {
  if (!config.icons) return;
  const configured = config.icons.library;
  const others = KNOWN_ICON_LIBRARIES.filter((library) => library !== configured);
  const srcAbs = path.join(root, config.srcDir);

  for (const file of (await listFiles(srcAbs)).filter(isCodeFile).sort()) {
    const text = await readFile(file, 'utf8');
    const fileRel = path.relative(root, file).split(path.sep).join('/');
    // Icons of the configured library are imported with the Icon suffix: SearchIcon, not Search.
    const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== configured) continue;
      const bindings = statement.importClause?.isTypeOnly ? undefined : statement.importClause?.namedBindings;
      for (const element of bindings && ts.isNamedImports(bindings) ? bindings.elements : []) {
        const imported = (element.propertyName ?? element.name).text;
        if (element.isTypeOnly || imported.endsWith('Icon')) continue;
        issues.push({
          severity: 'error',
          code: 'icon-name',
          path: fileRel,
          message: `"${imported}" is imported from ${configured} without the Icon suffix.`,
          hint: `Import it as ${imported.replace(/^Lucide(?=[A-Z])/, '')}Icon: icon names alone (Search, User) are too generic for a project.`,
        });
      }
    }
    for (const { value } of findSpecifiers(text)) {
      const library = others.find((other) => value === other || value.startsWith(`${other}/`));
      if (!library) continue;
      issues.push({
        severity: 'error',
        code: 'icon-library-mixed',
        path: path.relative(root, file).split(path.sep).join('/'),
        message: `"${value}" is another icon library, but the project uses ${configured}.`,
        hint: `Use the same icon from ${configured} ("reactsmith icon insert"), or change "icons.library" in ${CONFIG_FILE} for the whole project.`,
      });
    }
  }
}
