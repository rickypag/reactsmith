import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';

/** The router link to use instead of a plain link, per router library. */
const ROUTER_LINK: Record<string, string> = { 'react-router': 'NavLink' };

/**
 * Warns about plain links to a path of the site, `<a href="/docs">`, in a project with a router: they reload the
 * whole page. A warning, not an error: a file, a page the server renders or a deliberate reload are good reasons.
 */
export function plainLinkIssues(config: ResolvedConfig, fileRel: string, text: string): Issue[] {
  if (!config.router) return [];
  const link = ROUTER_LINK[config.router.library] ?? 'the router link';
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const issues: Issue[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(sourceFile) === 'a') {
      const href = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === 'href') as ts.JsxAttribute | undefined;
      const value = href?.initializer && ts.isStringLiteral(href.initializer) ? href.initializer.text : undefined;
      if (value !== undefined && value.startsWith('/') && !value.startsWith('//')) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        issues.push({
          severity: 'warning',
          code: 'plain-internal-link',
          path: fileRel,
          message: `<a href="${value}"> (line ${line}) links to a path of the site, so it reloads the whole page.`,
          hint: `Use <${link} to="${value}"> for a page of the app, e.g. "element insert ${link} --props 'to=\\"${value}\\"'". Keep <a> for files or pages the app doesn't render.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}
