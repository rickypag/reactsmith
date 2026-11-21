import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { isCodeFile } from '../imports/specifiers.js';
import type { Issue } from '../issues.js';
import { appRouterPath } from '../routes/app-router.js';

/** What creates a router in React Router: the factories, and the router components of declarative mode. */
const ROUTER_FACTORIES = new Set(['createBrowserRouter', 'createHashRouter', 'createMemoryRouter', 'createStaticRouter']);
const ROUTER_COMPONENTS = new Set(['BrowserRouter', 'HashRouter', 'MemoryRouter', 'StaticRouter']);
const ROUTER_PACKAGES = new Set(['react-router', 'react-router-dom']);

/** Tests and stories may build their own routers, e.g. a memory router around a component. */
const FREE_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

/** The names a file imports from React Router, local name → exported name. */
function routerImports(sourceFile: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !ROUTER_PACKAGES.has(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach((element) => names.set(element.name.text, (element.propertyName ?? element.name).text));
  }
  return names;
}

/** Whether a statement of a feature's routes file is allowed: imports, and the exported routes array. */
function isRoutesStatement(statement: ts.Statement): boolean {
  if (ts.isImportDeclaration(statement)) return true;
  if (!ts.isVariableStatement(statement)) return false;
  const exported = (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  return exported && statement.declarationList.declarations.every((declaration) => {
    let value = declaration.initializer;
    while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isParenthesizedExpression(value))) value = value.expression;
    return !!value && ts.isArrayLiteralExpression(value);
  });
}

/**
 * Checks that the app has one router, in the app router file: no other file creates one. A feature's routes file
 * only exports its routes, an array of route objects; pages, loaders and helpers live in its views.
 */
export async function checkRouter(root: string, config: ResolvedConfig): Promise<Issue[]> {
  if (!config.router) return [];
  const appRouter = appRouterPath(config);
  const { srcDir, folders, featureRoutes } = config;
  const issues: Issue[] = [];

  for (const file of (await listFiles(path.join(root, srcDir))).filter(isCodeFile)) {
    const fileRel = toRelative(root, file);
    if (fileRel === appRouter || FREE_FILE.test(fileRel)) continue;
    const text = await readFile(file, 'utf8');
    if (!/Router/.test(text)) continue;
    const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = routerImports(sourceFile);
    const visit = (node: ts.Node): void => {
      const name =
        ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ROUTER_FACTORIES.has(imports.get(node.expression.text) ?? '')
          ? node.expression.text
          : (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && ROUTER_COMPONENTS.has(imports.get(node.tagName.text) ?? '')
            ? `<${node.tagName.text}>`
            : undefined;
      if (name) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        issues.push({
          severity: 'error',
          code: 'router-outside-app-router',
          path: fileRel,
          message: `${name} (line ${line}) creates a router outside the app router.`,
          hint: `The app has one router, in ${appRouter ?? 'the app router file'}: add the routes there, or to a feature's routes, which the app router mounts.`,
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  if (featureRoutes) {
    const featuresAbs = path.join(root, srcDir, folders.features!);
    const features = new Set((await listFiles(featuresAbs).catch(() => [])).map((file) => toRelative(featuresAbs, file).split('/')[0]!));
    for (const feature of features) {
      const fileRel = `${srcDir}/${folders.features}/${feature}/${featureRoutes}`;
      const text = await readFile(path.join(root, fileRel), 'utf8').catch(() => undefined);
      if (text === undefined) continue;
      const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      for (const statement of sourceFile.statements) {
        if (isRoutesStatement(statement)) continue;
        const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
        issues.push({
          severity: 'error',
          code: 'routes-file-content',
          path: fileRel,
          message: `Line ${line} is not part of the routes: a routes file only exports its routes, an array of route objects.`,
          hint: 'Pages, loaders and helpers live in the views: "view create" makes the view and its route, and "--loader" its loader.',
        });
      }
    }
  }
  return issues;
}
