import path from 'node:path';
import ts from 'typescript';
import { CONFIG_FILE, HTML_SOURCE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue } from '../issues.js';
import { createTextHolderClassifier } from '../layout/classify.js';

/** The element directly holding a JSX text, or undefined at the top of a fragment. */
function holder(node: ts.JsxText): ts.JsxElement | undefined {
  return ts.isJsxElement(node.parent) ? node.parent : undefined;
}

/**
 * Reports text that is not directly inside a text component ("textComponents"): layout elements
 * and other components only arrange elements, so the structure of a component stays clear.
 */
export function textPlacementIssues(root: string, config: ResolvedConfig, fileRel: string, text: string): Issue[] {
  const absolute = path.join(root, fileRel);
  const sourceFile = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isText = createTextHolderClassifier(sourceFile, absolute, root, config);
  const examples = (config.textComponents[HTML_SOURCE] ?? []).slice(0, 4).join(', ');
  const issues: Issue[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && !node.containsOnlyTriviaWhiteSpaces) {
      const element = holder(node);
      if (!element || !isText(element.openingElement.tagName)) {
        const where = element ? `<${element.openingElement.tagName.getText(sourceFile)}>` : 'a fragment';
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        issues.push({
          severity: 'error',
          code: 'text-outside-text-element',
          path: fileRel,
          message: `Text "${node.text.trim()}" is directly in ${where} (line ${line}), but text belongs in a text element.`,
          hint: `Wrap it in a text element (${examples}…), or add ${where === 'a fragment' ? 'its element' : where} to "textComponents" in ${CONFIG_FILE}.`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return issues;
}
