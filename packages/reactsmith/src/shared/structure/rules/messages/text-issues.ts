import ts from 'typescript';
import { TOOL_NAME } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { listUnits } from '../../../tree/list-units.js';
import { unitFiles } from '../unit-files.js';

/** Text a reader sees: it has a letter. Punctuation, numbers and symbols alone ("·", "→", "2027") need no translation. */
const WORDS = /\p{L}/u;

/** The literal texts of a file: words written in the JSX, and strings shown as children ({"Workshops"}). */
function literalTexts(fileRel: string, text: string): string[] {
  const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && WORDS.test(node.text)) found.push(node.text.trim().replace(/\s+/g, ' '));
    if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression) && ts.isJsxElement(node.parent) && WORDS.test(node.expression.text)) found.push(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** In a translated app, the components, views and layouts show messages, not literal texts, which every language would show as they are. */
export async function textIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const unit of await listUnits(root, config)) {
    for (const { component, fileRel, text } of await unitFiles(root, unit)) {
      const texts = literalTexts(fileRel, text);
      if (texts.length === 0) continue;
      const shown = texts.slice(0, 3).map((value) => `"${value.length > 30 ? `${value.slice(0, 30)}…` : value}"`).join(', ');
      issues.push({
        severity: 'warning',
        code: 'text-not-translated',
        path: fileRel,
        message: `${component} shows ${texts.length === 1 ? 'a text' : `${texts.length} texts`} that every language would see as written: ${shown}${texts.length > 3 ? '…' : ''}.`,
        hint: `Make each one a message: "${TOOL_NAME} messages --set \\"${component}.<key>=…\\" --locale ${config.i18n!.defaultLocale}", then "element update <id> --message <key>".`,
      });
    }
  }
  return issues;
}
