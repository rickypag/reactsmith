import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../../../config/types.js';
import { listFiles, toRelative } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { listUnits } from '../../../tree/list-units.js';
import type { TreeUnit } from '../../../tree/types.js';
import { unitComponents } from '../unit-files.js';

const CODE_FILE = /\.tsx?$/;

/** The props types of the project's units, by name ("ProductCardProps"), with the unit that owns each. */
function propsTypes(units: TreeUnit[]): Map<string, TreeUnit> {
  const types = new Map<string, TreeUnit>();
  for (const unit of units) for (const component of unitComponents(unit)) types.set(`${component}Props`, unit);
  return types;
}

/** Whether a node sits in the props interface (or props type) of a component of `unit`: `items: BookCardProps[]`. */
function inPropsOf(node: ts.Node, unit: TreeUnit | undefined): boolean {
  if (!unit) return false;
  const names = new Set(unitComponents(unit).map((component) => `${component}Props`));
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) && names.has(parent.name.text)) return true;
  }
  return false;
}

/**
 * A component's props type is used only for props: by the component itself (anything in its own folder), and in the
 * props of other components (`items: BookCardProps[]`). Anywhere else (data in constants, state in an api hook, a
 * type in types/, a variable in another component) the data depends on the component: a new prop breaks it.
 * One issue per file and props type, at its first use.
 */
export async function propsTypeIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const units = await listUnits(root, config);
  const types = propsTypes(units);
  if (types.size === 0) return [];
  const pattern = new RegExp(`\\b(${[...types.keys()].join('|')})\\b`);
  const unitOf = (fileRel: string) => units.find((unit) => fileRel.startsWith(`${unit.folderRel}/`));
  const issues: Issue[] = [];

  for (const file of (await listFiles(path.join(root, config.srcDir)).catch(() => [])).filter((file) => CODE_FILE.test(file)).sort()) {
    const fileRel = toRelative(root, file);
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!pattern.test(text)) continue;
    const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, fileRel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const unit = unitOf(fileRel);
    const reported = new Set<string>();

    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
        const name = node.typeName.text;
        const owner = types.get(name);
        if (owner && owner !== unit && !inPropsOf(node, unit) && !reported.has(name)) {
          reported.add(name);
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const component = name.slice(0, -'Props'.length);
          issues.push({
            severity: 'error',
            code: 'props-type-outside-props',
            path: fileRel,
            message: `Line ${line} uses "${name}" outside the props of a component: what it types now changes whenever ${component}'s props do.`,
            hint: `Give it a type of its own (e.g. in types/), and pass it to ${component} through its props, e.g. {...item}.`,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return issues;
}
