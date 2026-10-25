import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import { componentFunction } from '../elements/tree.js';
import { specifierPath } from '../imports/specifiers.js';
import type { Issue } from '../issues.js';
import { isStyleable, propsInterface, STYLEABLE_INTERFACE, styleableFiles, styleablePropIn } from '../styles/styleable.js';

const parse = (fileRel: string, text: string) => ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

async function readOptional(file: string): Promise<string | undefined> {
  return readFile(file, 'utf8').catch(() => undefined);
}

/** The styleable prop of the project: "className", unless StyleableProps renames it. */
async function projectStyleableProp(root: string, config: ResolvedConfig): Promise<string> {
  const files = styleableFiles(config);
  return styleablePropIn(files ? await readOptional(path.join(root, files.interfaceRel)) : undefined);
}

/** The local names a file imports, with their specifiers. */
function importedNames(sourceFile: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
    const clause = statement.importClause;
    if (clause?.name) names.set(clause.name.text, statement.moduleSpecifier.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) bindings.elements.forEach((element) => names.set(element.name.text, (statement.moduleSpecifier as ts.StringLiteral).text));
  }
  return names;
}

/**
 * Checks how components of the project are styled from their parents, in a component, view or layout file:
 * they take no inline style, and a class only when they are styleable. In a component file, a styleable component
 * must merge the class into its root: className={cx(styles.root, className)}.
 */
export async function componentStyleIssues(root: string, config: ResolvedConfig, fileRel: string, text: string, component?: string): Promise<Issue[]> {
  const sourceFile = parse(fileRel, text);
  const prop = await projectStyleableProp(root, config);
  const imports = importedNames(sourceFile);
  const srcAbs = path.join(root, config.srcDir);
  const issues: Issue[] = [];
  const lineOf = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const usages: { tag: string; node: ts.JsxOpeningElement | ts.JsxSelfClosingElement }[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[A-Z]/.test(node.tagName.text)) {
      usages.push({ tag: node.tagName.text, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  for (const { tag, node } of usages) {
    const specifier = imports.get(tag);
    const target = specifier ? specifierPath(specifier, path.join(root, fileRel), srcAbs, config.alias) : undefined;
    // Only components of the project: a folder holding <Name>.tsx. Packages style their own way.
    const componentText = target ? await readOptional(path.join(target.base, `${tag}.tsx`)) : undefined;
    if (componentText === undefined) continue;
    const names = node.attributes.properties.flatMap((attribute) => (ts.isJsxAttribute(attribute) ? [attribute.name.getText(sourceFile)] : []));
    if (names.includes('style')) {
      issues.push({
        severity: 'error',
        code: 'component-inline-style',
        path: fileRel,
        message: `<${tag}> (line ${lineOf(node)}) takes an inline style, but a component of the project is styled with a class from its parent's style file.`,
        hint: `Give it a style instead: "style update <element> --name <style> --css …".`,
      });
    }
    if (names.includes(prop) && !isStyleable(propsInterface(parse(`${tag}.tsx`, componentText), tag))) {
      issues.push({
        severity: 'error',
        code: 'component-not-styleable',
        path: fileRel,
        message: `<${tag}> (line ${lineOf(node)}) gets a ${prop}, but "${tag}" doesn't take one: its props don't extend ${STYLEABLE_INTERFACE}.`,
        hint: `Style it with "style update", which makes "${tag}" styleable, or extend ${STYLEABLE_INTERFACE} and merge the ${prop} into its root.`,
      });
    }
  }

  // A styleable component merges the class into its root, and only there.
  const declaration = component ? propsInterface(sourceFile, component) : undefined;
  if (component && isStyleable(declaration)) {
    const fn = componentFunction(sourceFile, component);
    let merged = false;
    const find = (node: ts.Node): void => {
      if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'className' && node.initializer && ts.isJsxExpression(node.initializer)) {
        const value = node.initializer.expression?.getText(sourceFile).replace(/\s+/g, '');
        if (value === `cx(styles.root,${prop})` || value === `cx(${prop})`) merged = true;
      }
      ts.forEachChild(node, find);
    };
    if (fn) find(fn);
    if (!merged) {
      issues.push({
        severity: 'error',
        code: 'styleable-not-merged',
        path: fileRel,
        message: `"${component}" extends ${STYLEABLE_INTERFACE}, but its root doesn't merge the ${prop}.`,
        hint: `Write its root as className={cx(styles.root, ${prop})}.`,
      });
    }
  }
  return issues;
}
