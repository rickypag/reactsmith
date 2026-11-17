import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { relativeImport } from '../imports/specifiers.js';
import type { Issue } from '../issues.js';
import { isDataLiteral } from './literal.js';

/** The file holding constants: in a component folder, at a feature's root, and at the app's root. */
export const CONSTANTS_FILE = 'constants.ts';

export interface ExportedConstant {
  name: string;
  statement: ts.VariableStatement;
  declaration: ts.VariableDeclaration;
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

/** The constants a constants file exports: `export const NAME = …`. */
export function exportedConstants(sourceFile: ts.SourceFile): ExportedConstant[] {
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) return [];
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [{ name: declaration.name.text, statement, declaration }] : [],
    );
  });
}

export function parseConstants(fileName: string, text: string): { sourceFile: ts.SourceFile; constants: ExportedConstant[] } {
  const sourceFile = parse(fileName, text);
  return { sourceFile, constants: exportedConstants(sourceFile) };
}

/** What is wrong with a constants file: it may only export constants holding plain data. */
export function constantsFileProblems(fileName: string, text: string): string[] {
  const sourceFile = parse(fileName, text);
  const problems: string[] = [];
  for (const statement of sourceFile.statements) {
    const line = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile)).line + 1;
    // The types the constants are annotated with ("constant create --type") are imported as types only.
    if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
    const isConst = ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    if (!isConst || !isExported(statement)) {
      problems.push(`Line ${line} is not an exported constant: a constants file only holds "export const NAME = …".`);
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(sourceFile);
      if (!ts.isIdentifier(declaration.name)) problems.push(`Line ${line} destructures "${name}": declare each constant by name.`);
      else if (!declaration.initializer || !isDataLiteral(declaration.initializer)) {
        problems.push(`The constant "${name}" (line ${line}) is not plain data: only strings, numbers, booleans, null, arrays and objects.`);
      }
    }
  }
  return problems;
}

/** Every constants file of the project, relative to the root. */
export async function allConstantsFiles(root: string, config: ResolvedConfig): Promise<string[]> {
  const files = await listFiles(path.join(root, config.srcDir)).catch(() => []);
  return files.filter((file) => path.basename(file) === CONSTANTS_FILE).map((file) => toRelative(root, file)).sort();
}

/** Checks the content of every constants file. */
export async function checkConstantsFiles(root: string, config: ResolvedConfig, read: (fileRel: string) => Promise<string | undefined>): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const fileRel of await allConstantsFiles(root, config)) {
    const text = await read(fileRel);
    if (text === undefined) continue;
    for (const problem of constantsFileProblems(fileRel, text)) {
      issues.push({
        severity: 'error',
        code: 'constants-file-content',
        path: fileRel,
        message: problem,
        hint: 'Write constants with "constant create", e.g. constant create SITE_NAME --app --value \'"Docs"\'. Logic goes in utils.ts or in components.',
      });
    }
  }
  return issues;
}

/**
 * The constants files a file can use, nearest first, with the specifier to import them:
 * its own folder's (a component's), its feature's, and the app's when the import rules allow it.
 */
export function visibleConstantsFiles(config: ResolvedConfig, fileRel: string): { fileRel: string; specifier: string }[] {
  const { srcDir, folders, imports } = config;
  const dir = path.posix.dirname(fileRel);
  const visible: { fileRel: string; specifier: string }[] = [];
  const add = (constantsRel: string, specifier = relativeImport(fileRel, constantsRel)) => {
    if (!visible.some((entry) => entry.fileRel === constantsRel)) visible.push({ fileRel: constantsRel, specifier });
  };

  add(`${dir}/${CONSTANTS_FILE}`, `./${CONSTANTS_FILE.replace(/\.ts$/, '')}`);
  const featuresRel = `${srcDir}/${folders.features}/`;
  const appRel = folders.app ? `${srcDir}/${folders.app}` : undefined;
  if (fileRel.startsWith(featuresRel)) {
    const feature = fileRel.slice(featuresRel.length).split('/')[0]!;
    add(`${featuresRel}${feature}/${CONSTANTS_FILE}`);
  }
  if (appRel) {
    const appConstants = `${appRel}/${CONSTANTS_FILE}`;
    const inApp = fileRel.startsWith(`${appRel}/`);
    const allowed = inApp || (fileRel.startsWith(featuresRel) ? imports.featuresImportApp : imports.sharedImportApp);
    if (allowed) add(appConstants, !inApp && config.alias ? `${config.alias}/${folders.app}/${CONSTANTS_FILE.replace(/\.ts$/, '')}` : relativeImport(fileRel, appConstants));
  }
  return visible;
}

/**
 * The constants a file can use, each with the specifier it is imported from, nearest first. `hidden` holds the app's
 * constants a feature or shared file can't use (the import rules keep the app out of them), by name, with their file:
 * a refusal of one of them then says why.
 */
export type ConstantsInScope = Map<string, string> & { hidden?: Map<string, string> };

export async function availableConstants(changes: ChangeSet, config: ResolvedConfig, fileRel: string): Promise<ConstantsInScope> {
  const available: ConstantsInScope = new Map<string, string>();
  const visible = visibleConstantsFiles(config, fileRel);
  for (const { fileRel: constantsRel, specifier } of visible) {
    if (constantsRel === fileRel) continue;
    const text = await changes.read(constantsRel);
    if (text === undefined) continue;
    for (const { name } of parseConstants(constantsRel, text).constants) {
      if (!available.has(name)) available.set(name, specifier);
    }
  }
  const appConstants = config.folders.app ? `${config.srcDir}/${config.folders.app}/${CONSTANTS_FILE}` : undefined;
  if (appConstants && !visible.some((entry) => entry.fileRel === appConstants)) {
    const text = await changes.read(appConstants);
    const hidden = new Map<string, string>();
    for (const { name } of text === undefined ? [] : parseConstants(appConstants, text).constants) if (!available.has(name)) hidden.set(name, appConstants);
    if (hidden.size) available.hidden = hidden;
  }
  return available;
}
