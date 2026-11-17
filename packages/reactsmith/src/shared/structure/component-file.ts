import ts from 'typescript';

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isExported(node: ts.Statement): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** "function formatDate", "type Options", "default export"… for messages. */
function describe(statement: ts.Statement): string {
  const named = (kind: string, name?: ts.Node) => (name && ts.isIdentifier(name) ? `${kind} "${name.text}"` : kind);
  if (ts.isFunctionDeclaration(statement)) return named('function', statement.name);
  if (ts.isClassDeclaration(statement)) return named('class', statement.name);
  if (ts.isInterfaceDeclaration(statement)) return named('interface', statement.name);
  if (ts.isTypeAliasDeclaration(statement)) return named('type', statement.name);
  if (ts.isEnumDeclaration(statement)) return named('enum', statement.name);
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.map((d) => named('constant', d.name)).join(', ');
  }
  if (ts.isExportAssignment(statement)) return 'default export';
  if (ts.isExportDeclaration(statement)) return 're-export';
  return 'statement';
}

/** The `'use client'` directive. */
export function isUseClient(statement: ts.Statement): boolean {
  return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === 'use client';
}

/** `React.FC`, `React.FC<Props>`, `FC` or `FC<Props>`. */
function isFcType(type: ts.TypeNode | undefined): boolean {
  if (!type || !ts.isTypeReferenceNode(type)) return false;
  const name = type.typeName;
  if (ts.isIdentifier(name)) return name.text === 'FC';
  return ts.isIdentifier(name.left) && name.left.text === 'React' && name.right.text === 'FC';
}

/** `memo(...)` or `React.memo(...)`. */
function isMemoCall(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) return false;
  const callee = expression.expression;
  if (ts.isIdentifier(callee)) return callee.text === 'memo';
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === 'React' && callee.name.text === 'memo';
}

/**
 * Problems in a component file, which may only contain imports, the component `name`
 * (an exported arrow function typed React.FC, or wrapped in memo) and its `<name>Props` interface.
 */
export function componentFileProblems(text: string, fileName: string, name: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const problems: string[] = [];
  let component = false;

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) continue;
    // A client component (Next.js, React Server Components) starts with the 'use client' directive.
    if (statement === sourceFile.statements[0] && isUseClient(statement)) continue;
    const at = `(line ${lineOf(sourceFile, statement)})`;

    if (ts.isInterfaceDeclaration(statement) && statement.name.text === `${name}Props`) continue;

    // The component written as a function or class declaration: one clear problem, not "not found".
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) {
      component = true;
      problems.push(`"${name}" must be an arrow function: "export const ${name}: React.FC = () => …" ${at}.`);
      continue;
    }

    const declarations = ts.isVariableStatement(statement) ? statement.declarationList.declarations : [];
    const declaration = declarations.length === 1 ? declarations[0] : undefined;
    if (ts.isVariableStatement(statement) && declaration && ts.isIdentifier(declaration.name) && declaration.name.text === name) {
      component = true;
      const initializer = declaration.initializer;
      if (!isExported(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) {
        problems.push(`"${name}" must be declared with "export const" ${at}.`);
      } else if (initializer && isMemoCall(initializer)) {
        // memo(...) wraps the component: its own type comes from memo.
      } else if (!initializer || !ts.isArrowFunction(initializer)) {
        problems.push(`"${name}" must be an arrow function ${at}.`);
      } else if (!isFcType(declaration.type)) {
        problems.push(`"${name}" must be typed as React.FC, e.g. "export const ${name}: React.FC = () => …" ${at}.`);
      }
      continue;
    }

    problems.push(`Only the component "${name}" and its props interface "${name}Props" belong here, found ${describe(statement)} ${at}.`);
  }

  if (!component) problems.unshift(`No component "${name}" found: expected "export const ${name}: React.FC = () => …".`);
  return problems;
}

/** Problems in a view's entry point, which only re-exports the view as `Component` (and its loader). */
export function viewEntryProblems(text: string, fileName: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  let exportsComponent = false;
  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause) && clause.elements.some((element) => element.name.text === 'Component')) {
        exportsComponent = true;
      }
      continue;
    }
    problems.push(`Only re-exports ("export { … } from '…'") belong here, found ${describe(statement)} (line ${lineOf(sourceFile, statement)}).`);
  }
  if (!exportsComponent) problems.unshift('The view is not exported as "Component", which React Router\'s lazy routes need.');
  return problems;
}

/**
 * Problems in a component's entry point. The component is a black box: the entry point only re-exports
 * the component `name` and, optionally, its `<name>Props` type.
 */
export function componentEntryProblems(text: string, fileName: string, name: string, kind: 'component' | 'view' = 'component'): string[] {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const allowed = new Set([name, `${name}Props`]);
  const problems: string[] = [];
  let exportsComponent = false;
  for (const statement of sourceFile.statements) {
    const at = `(line ${lineOf(sourceFile, statement)})`;
    const clause = ts.isExportDeclaration(statement) && statement.moduleSpecifier ? statement.exportClause : undefined;
    if (!clause || !ts.isNamedExports(clause)) {
      problems.push(`Only re-exports ("export { ${name} } from './${name}'") belong here, found ${describe(statement)} ${at}.`);
      continue;
    }
    for (const element of clause.elements) {
      if (element.name.text === name) exportsComponent = true;
      else if (!allowed.has(element.name.text)) {
        problems.push(`Only "${name}" and its "${name}Props" type may be exported, found "${element.name.text}" ${at}.`);
      }
    }
  }
  if (!exportsComponent) problems.unshift(`The ${kind} "${name}" is not exported.`);
  return problems;
}
