import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

export const VITE_CONFIG_FILES = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];

export type ViteAliasResult =
  | { status: 'added'; text: string; description: string }
  | { status: 'exists' }
  | { status: 'manual'; reason: string };

export interface ViteAliasOptions {
  alias: string;
  srcDir: string;
  /** Vite 8+ reads the alias from tsconfig "paths" with resolve.tsconfigPaths. */
  useTsconfigPaths: boolean;
}

/** Returns the major version of the Vite installed in (or above) the project, if any. */
export async function detectViteMajor(root: string): Promise<number | undefined> {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const pkg = JSON.parse(await readFile(require.resolve('vite/package.json'), 'utf8')) as { version: string };
    return Number.parseInt(pkg.version, 10);
  } catch {
    return undefined;
  }
}

function findConfigObject(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined {
  let found: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'defineConfig' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      found = node.arguments[0];
      return;
    }
    if (ts.isExportAssignment(node) && ts.isObjectLiteralExpression(node.expression)) {
      found = node.expression;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

function findProperty(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      property.name.text === name,
  );
}

function lineIndent(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', position - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** Inserts a property (given as lines) at the end of an object literal, matching its indentation and trailing comma. */
function insertProperty(text: string, sourceFile: ts.SourceFile, object: ts.ObjectLiteralExpression, lines: string[]): string {
  const { properties } = object;
  if (properties.length === 0) {
    const baseIndent = lineIndent(text, object.getStart(sourceFile));
    const indent = `${baseIndent}  `;
    const at = object.getStart(sourceFile) + 1;
    return `${text.slice(0, at)}\n${indent}${lines.join(`\n${indent}`)},\n${baseIndent}${text.slice(object.end - 1)}`;
  }

  const indent = lineIndent(text, properties[0]!.getStart(sourceFile));
  const property = lines.join(`\n${indent}`);
  const last = properties[properties.length - 1]!;
  const afterLast = text.slice(last.end);
  const comma = /^\s*,/.exec(afterLast);
  if (comma) {
    const at = last.end + comma[0].length;
    return `${text.slice(0, at)}\n${indent}${property},${text.slice(at)}`;
  }
  return `${text.slice(0, last.end)},\n${indent}${property}${text.slice(last.end)}`;
}

function addImport(text: string, sourceFile: ts.SourceFile, statement: string): string {
  const imports = sourceFile.statements.filter(ts.isImportDeclaration);
  const last = imports[imports.length - 1];
  const semicolon = last && !last.getText(sourceFile).endsWith(';') ? '' : ';';
  const line = `${statement}${semicolon}`;
  if (!last) return `${line}\n${text}`;
  return `${text.slice(0, last.end)}\n${line}${text.slice(last.end)}`;
}

/** Configures the import alias in a Vite config, editing the text so formatting is kept. */
export function addViteAlias(text: string, fileName: string, options: ViteAliasOptions): ViteAliasResult {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const config = findConfigObject(sourceFile);
  if (!config) return { status: 'manual', reason: 'could not find the object passed to defineConfig()' };

  const resolve = findProperty(config, 'resolve');
  const resolveObject = resolve && ts.isObjectLiteralExpression(resolve.initializer) ? resolve.initializer : undefined;
  if (resolve && !resolveObject) return { status: 'manual', reason: '"resolve" is not a plain object' };

  if (options.useTsconfigPaths) {
    if (resolveObject && findProperty(resolveObject, 'tsconfigPaths')) return { status: 'exists' };
    const updated = resolveObject
      ? insertProperty(text, sourceFile, resolveObject, ['tsconfigPaths: true'])
      : insertProperty(text, sourceFile, config, ['resolve: {', '  tsconfigPaths: true,', '}']);
    return { status: 'added', text: updated, description: 'enabled resolve.tsconfigPaths' };
  }

  const aliasEntry = `'${options.alias}': fileURLToPath(new URL('./${options.srcDir}', import.meta.url))`;
  const aliasProperty = resolveObject ? findProperty(resolveObject, 'alias') : undefined;
  if (aliasProperty) {
    if (!ts.isObjectLiteralExpression(aliasProperty.initializer)) {
      return { status: 'manual', reason: '"resolve.alias" is not a plain object' };
    }
    if (findProperty(aliasProperty.initializer, options.alias)) return { status: 'exists' };
    return { status: 'manual', reason: `"resolve.alias" exists but has no "${options.alias}" entry` };
  }

  let updated = resolveObject
    ? insertProperty(text, sourceFile, resolveObject, ['alias: {', `  ${aliasEntry},`, '}'])
    : insertProperty(text, sourceFile, config, ['resolve: {', '  alias: {', `    ${aliasEntry},`, '  },', '}']);
  if (!/\bfileURLToPath\b/.test(text)) {
    updated = addImport(updated, sourceFile, "import { fileURLToPath } from 'node:url'");
  }
  return { status: 'added', text: updated, description: `added resolve.alias "${options.alias}"` };
}
