import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import type { Issue } from '../issues.js';
import { CODE_FOLDERS, type CodeFolder } from './imports.js';

/** Tests and stories are the dev's choice: no rules for them in v1. */
const FREE_FILE = /\.(test|spec|stories)\.[cm]?[jt]sx?$/;

const HOOK_NAME = /^use[A-Z]/;

function isExported(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** The code folders of the project: the shared ones at the top of srcDir, and each feature's. */
async function codeFolders(root: string, config: ResolvedConfig): Promise<{ kind: CodeFolder; folderRel: string }[]> {
  const { srcDir, folders, featureFolders } = config;
  const found: { kind: CodeFolder; folderRel: string }[] = [];
  for (const kind of CODE_FOLDERS) if (folders[kind]) found.push({ kind, folderRel: `${srcDir}/${folders[kind]}` });
  const features = await listFiles(path.join(root, srcDir, folders.features!)).catch(() => []);
  const names = new Set(features.map((file) => toRelative(path.join(root, srcDir, folders.features!), file).split('/')[0]!));
  for (const feature of names) {
    for (const kind of CODE_FOLDERS) if (featureFolders[kind]) found.push({ kind, folderRel: `${srcDir}/${folders.features}/${feature}/${featureFolders[kind]}` });
  }
  return found;
}

/** What is wrong with a file of a code folder, given what the folder is for. */
function fileProblems(kind: CodeFolder, fileName: string, sourceFile: ts.SourceFile): { code: string; message: string; hint: string }[] {
  const problems: { code: string; message: string; hint: string }[] = [];
  const line = (node: ts.Node) => sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  if (fileName === 'index.ts') {
    for (const statement of sourceFile.statements) {
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) continue;
      problems.push({ code: 'barrel-content', message: `Line ${line(statement)} is not a re-export: the barrel only lists what the folder offers.`, hint: "Write the code in a file of the folder, and re-export it: export { formatDate } from './date';" });
    }
    return problems;
  }

  if (kind === 'types') {
    for (const statement of sourceFile.statements) {
      const typeOnly =
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        (ts.isImportDeclaration(statement) && !!statement.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(statement) && statement.isTypeOnly);
      if (!typeOnly) problems.push({ code: 'types-runtime-code', message: `Line ${line(statement)} is not a type: the types folder only holds types.`, hint: 'Move values and functions to utils/ or constants.ts; import types with "import type".' });
    }
  }

  if (kind === 'hooks') {
    for (const statement of sourceFile.statements) {
      if (!isExported(statement)) continue;
      const names = ts.isFunctionDeclaration(statement) && statement.name
        ? [statement.name]
        : ts.isVariableStatement(statement)
          ? statement.declarationList.declarations.flatMap((declaration) => (ts.isIdentifier(declaration.name) ? [declaration.name] : []))
          : [];
      for (const name of names) {
        if (!HOOK_NAME.test(name.text)) problems.push({ code: 'hook-name', message: `"${name.text}" (line ${line(name)}) is not named like a hook: what hooks/ exports is named useX.`, hint: `Rename it, e.g. "use${name.text[0]!.toUpperCase()}${name.text.slice(1)}", or move it to utils/ if it isn't a hook.` });
      }
    }
  }

  if (kind === 'utils') {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && HOOK_NAME.test(node.expression.text)) {
        problems.push({ code: 'utils-uses-hook', message: `${node.expression.text}() (line ${line(node)}) is a hook: utils are plain functions.`, hint: 'Move the code that uses hooks to hooks/, as a hook.' });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return problems;
}

/**
 * Checks the hooks, utils, types and stores folders, shared and of each feature: .ts files only (no JSX: that is for
 * components), barrels that only re-export, and what each folder is for: utils are plain functions, what hooks
 * export is named useX, types holds only types. How their files group the code is free.
 */
export async function checkCodeFolders(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const { kind, folderRel } of await codeFolders(root, config)) {
    for (const file of await listFiles(path.join(root, folderRel)).catch(() => [])) {
      const fileRel = toRelative(root, file);
      const fileName = path.basename(file);
      if (FREE_FILE.test(fileName)) continue;
      if (!fileName.endsWith('.ts') || fileName.endsWith('.d.ts')) {
        if (/\.[cm]?[jt]sx?$/.test(fileName) && !fileName.endsWith('.d.ts')) {
          issues.push({ severity: 'error', code: 'code-folder-file-type', path: fileRel, message: `${fileName} is not a .ts file: ${kind}/ holds plain TypeScript, no JSX.`, hint: 'JSX belongs to components, views and layouts: move it there, or rename the file to .ts.' });
        }
        continue;
      }
      const text = await readFile(file, 'utf8');
      const sourceFile = ts.createSourceFile(fileRel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      for (const problem of fileProblems(kind, fileName, sourceFile)) issues.push({ severity: 'error', path: fileRel, ...problem });
    }
  }
  return issues;
}
