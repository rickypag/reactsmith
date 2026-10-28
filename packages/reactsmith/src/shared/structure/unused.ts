import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { barrelExportsOf, importersOf, projectImports } from '../components/importers.js';
import { projectComponents } from '../components/registry.js';
import { STYLE_FILE_SUFFIXES } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import type { Issue } from '../issues.js';

const readOptional = (file: string) => readFile(file, 'utf8').catch(() => undefined);

/**
 * The classes a CSS file declares, in the selectors of its rules, nested ones included (`&.active {…}`).
 * At-rule preludes (@media…) and the inside of attribute selectors and :not()/:has() arguments don't count.
 */
function cssClasses(text: string): Set<string> {
  const classes = new Set<string>();
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of code.matchAll(/(?<=^|[{};])([^{};]*)\{/g)) {
    const selector = match[1]!.trim();
    if (selector.startsWith('@')) continue;
    for (const name of selector.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(name[1]!);
  }
  return classes;
}

/** The keys of `export const styles = {…}` in a Tailwind styles file. */
function tailwindKeys(fileName: string, text: string): Set<string> {
  const keys = new Set<string>();
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let value = declaration.initializer;
      while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) value = value.expression;
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'styles' || !value || !ts.isObjectLiteralExpression(value)) continue;
      for (const property of value.properties) if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) keys.add(property.name.text);
    }
  }
  return keys;
}

/**
 * The styles a component's code uses from a style file: `<local>.name` and `<local>['name']`, in the files of its
 * folder that import it. Undefined when no file imports it, or when one reads it by a computed key (styles[variant]).
 */
async function usedStyles(dirAbs: string, styleBase: string): Promise<Set<string> | undefined> {
  const used = new Set<string>();
  let imported = false;
  const files = (await listFiles(dirAbs).catch(() => [] as string[])).filter((file) => path.dirname(file) === dirAbs && /\.[jt]sx?$/.test(file));
  for (const file of files) {
    const text = (await readOptional(file)) ?? '';
    const escaped = styleBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const local = new RegExp(`import\\s+(?:(\\w+)|\\{[^}]*?\\bstyles(?:\\s+as\\s+(\\w+))?[^}]*\\})\\s+from\\s+['"]\\./${escaped}(?:\\.js)?['"]`).exec(text);
    if (!local) continue;
    imported = true;
    const name = local[1] ?? local[2] ?? 'styles';
    if (new RegExp(`\\b${name}\\[(?!\\s*['"])`).test(text)) return undefined;
    for (const match of text.matchAll(new RegExp(`\\b${name}(?:\\.(\\w+)|\\[\\s*['"]([\\w-]+)['"]\\s*\\])`, 'g'))) used.add(match[1] ?? match[2]!);
  }
  return imported ? used : undefined;
}

/** Warns about the styles of a style file (CSS Modules or Tailwind) that no element of its component uses. */
async function unusedStyleIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  const suffixes = Object.values(STYLE_FILE_SUFFIXES);
  for (const file of (await listFiles(path.join(root, config.srcDir))).sort()) {
    const suffix = suffixes.find((candidate) => file.endsWith(candidate));
    if (!suffix) continue;
    const text = await readOptional(file);
    if (text === undefined) continue;
    const fileName = path.basename(file);
    const declared = suffix === '.module.css' ? cssClasses(text) : tailwindKeys(fileName, text);
    const used = await usedStyles(path.dirname(file), fileName.replace(/\.ts$/, ''));
    if (!used) continue;
    const component = `${fileName.slice(0, -suffix.length)}.tsx`;
    for (const name of [...declared].filter((candidate) => !used.has(candidate))) {
      issues.push({
        severity: 'warning',
        code: 'style-unused',
        path: toRelative(root, file),
        message: `The style "${name}" is not used: no element of ${component} has className={styles.${name}}.`,
        hint: `Give it to an element with "style update <element> --name ${name}", or delete its rule.`,
      });
    }
  }
  return issues;
}

/** Warns about components and layouts nothing outside their folder imports. */
async function unusedComponentIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  const imports = await projectImports(root, config, (fileRel) => readOptional(path.join(root, fileRel)));
  const barrels = new Map<string, string | undefined>();
  for (const component of await projectComponents(root, config)) {
    const isShared = !!config.folders.components && component.folderRel.startsWith(`${config.srcDir}/${config.folders.components}/`);
    const barrelRel = `${path.posix.dirname(component.folderRel)}/index.ts`;
    if (isShared && !barrels.has(barrelRel)) barrels.set(barrelRel, await readOptional(path.join(root, barrelRel)));
    const barrelText = isShared ? barrels.get(barrelRel) : undefined;
    const barrelNames = barrelText === undefined ? [] : barrelExportsOf(barrelRel, barrelText, component.name);
    if (importersOf(imports, root, component, barrelNames).length) continue;
    const isLayout = !!config.folders.app && !!config.appFolders.layouts && component.folderRel.startsWith(`${config.srcDir}/${config.folders.app}/${config.appFolders.layouts}/`);
    issues.push({
      severity: 'warning',
      code: 'component-unused',
      path: component.folderRel,
      message: `${isLayout ? 'Layout' : 'Component'} "${component.name}" is not used: nothing outside its folder imports it.`,
      hint: isLayout ? 'Render it in the app router, or delete its folder.' : `Use it with "element insert ${component.name}", or delete it with "component remove ${component.name}".`,
    });
  }
  return issues;
}

/** Warnings for what nothing uses: styles of a style file, components and layouts. */
export async function checkUnused(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return [...(await unusedStyleIssues(root, config)), ...(await unusedComponentIssues(root, config))];
}
