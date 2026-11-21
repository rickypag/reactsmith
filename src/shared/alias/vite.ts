import ts from 'typescript';
import { addImport, insertListItem } from '../code/insert.js';

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
      ? insertListItem(text, sourceFile, resolveObject, ['tsconfigPaths: true'])
      : insertListItem(text, sourceFile, config, ['resolve: {', '  tsconfigPaths: true,', '}']);
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
    ? insertListItem(text, sourceFile, resolveObject, ['alias: {', `  ${aliasEntry},`, '}'])
    : insertListItem(text, sourceFile, config, ['resolve: {', '  alias: {', `    ${aliasEntry},`, '  },', '}']);
  if (!/\bfileURLToPath\b/.test(text)) {
    updated = addImport(updated, sourceFile, "import { fileURLToPath } from 'node:url'");
  }
  return { status: 'added', text: updated, description: `added resolve.alias "${options.alias}"` };
}
