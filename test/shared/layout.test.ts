import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/shared/config/validate.js';
import { createLayoutClassifier } from '../../src/shared/layout/classify.js';

const root = path.resolve('/project');
const file = path.join(root, 'src/features/docs/components/Sidebar/Sidebar.tsx');

/** The JSX tags in `text` that are layout components, in order. */
function layoutTags(text: string, layoutComponents?: Record<string, string[]>): string[] {
  const { config } = validateConfig(layoutComponents ? { layoutComponents } : {});
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isLayout = createLayoutClassifier(sourceFile, file, root, config!);
  const tags: string[] = [];
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isLayout(node.tagName)) {
      tags.push(node.tagName.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return tags;
}

describe('createLayoutClassifier', () => {
  it('matches the default HTML layout elements, not content elements or components', () => {
    const text = "import { Card } from '@/components/Card';\nconst x = <div><nav><button /><p /><Card /></nav></div>;";
    expect(layoutTags(text)).toEqual(['div', 'nav']);
  });

  it('matches library components only when imported from the configured source', () => {
    const mui = { '@mui/material': ['Stack', 'Box'], html: ['nav'] };
    const text = [
      "import { Stack as S } from '@mui/material';",
      "import Box from '@mui/material/Box';",
      "import * as M from '@mui/material';",
      "import { Stack } from './Stack';",
      '<S><Box /><M.Stack /><M.Button /><Stack /><div /><nav /></S>;',
    ].join('\n');
    expect(layoutTags(text, mui)).toEqual(['S', 'Box', 'M.Stack', 'nav']);
  });

  it('matches alias paths through alias and relative imports', () => {
    const own = { '@/components/layout': ['Row'] };
    const text = [
      "import { Row } from '@/components/layout';",
      "import { Row as R } from '../../../../components/layout';",
      "import { Row as Other } from '@/components/Row';",
      '<Row><R /><Other /></Row>;',
    ].join('\n');
    expect(layoutTags(text, own)).toEqual(['Row', 'R']);
  });
});
