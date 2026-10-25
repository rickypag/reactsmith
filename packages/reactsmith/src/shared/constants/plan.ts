import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { ChangeSet } from '../changes.js';
import { cut, removalRange } from '../code/remove.js';
import type { ResolvedConfig } from '../config/types.js';
import { listFiles, toRelative } from '../files.js';
import { isCodeFile, specifierPath } from '../imports/specifiers.js';
import { IssueError } from '../issues.js';
import { allConstantsFiles, CONSTANTS_FILE, parseConstants } from './files.js';
import { toLiteral } from './literal.js';

/** Where a constant lives: the app, a feature, or a component folder ("app/components/Sidebar"). */
export type ConstantOwner = { app: true } | { feature: string } | { component: string };

export interface ConstantValue {
  /** JSON given inline. */
  value?: string;
  /** A JSON file, relative to the project root. */
  file?: string;
}

export interface ConstantResult {
  name: string;
  /** Project-relative path of the constants file. */
  file: string;
}

function constantError(code: string, message: string, hint: string, issuePath?: string): IssueError {
  return new IssueError({ severity: 'error', code, path: issuePath, message, hint });
}

const isDirectory = (file: string) => stat(file).then((info) => info.isDirectory(), () => false);

/** The owner from --app, --feature and --component: exactly one of them. */
export function constantOwner(options: { app?: boolean; feature?: string; component?: string }): ConstantOwner {
  const given = [options.app ? 'app' : undefined, options.feature !== undefined ? 'feature' : undefined, options.component !== undefined ? 'component' : undefined].filter(Boolean);
  if (given.length !== 1) {
    throw constantError(
      given.length ? 'options-conflict' : 'owner-missing',
      given.length ? `--${given.join(', --')} cannot be used together.` : 'Say where the constant lives.',
      'Pass --app for the whole app, --feature <name> for a feature, or --component <folder> for one component.',
    );
  }
  if (options.app) return { app: true };
  if (options.feature !== undefined) return { feature: options.feature };
  return { component: options.component! };
}

/** The constants file of an owner, checking that the owner exists. */
export async function constantsFileOf(root: string, config: ResolvedConfig, owner: ConstantOwner): Promise<string> {
  const { srcDir, folders } = config;
  if ('app' in owner) {
    if (!folders.app) throw constantError('app-folder-missing', 'The project has no app folder.', 'Set "folders.app" in the config, or use --feature or --component.');
    return `${srcDir}/${folders.app}/${CONSTANTS_FILE}`;
  }
  if ('feature' in owner) {
    const featureRel = `${srcDir}/${folders.features}/${owner.feature}`;
    if (!(await isDirectory(path.join(root, featureRel)))) {
      throw constantError('feature-missing', `Feature "${owner.feature}" does not exist.`, `Create it first with "feature create ${owner.feature}".`, featureRel);
    }
    return `${featureRel}/${CONSTANTS_FILE}`;
  }

  // A component folder, relative to srcDir (as in element ids) or to the project root.
  const given = owner.component.replace(/\\/g, '/').replace(/\/+$/, '');
  const fromRoot = given.startsWith(`${srcDir}/`) ? given : `${srcDir}/${given}`;
  const name = path.posix.basename(fromRoot);
  const isComponent = (await isDirectory(path.join(root, fromRoot))) && (await stat(path.join(root, fromRoot, `${name}.tsx`)).then(() => true, () => false));
  if (!isComponent) {
    throw constantError('component-missing', `"${owner.component}" is not a component folder.`, 'Pass the folder of a component, e.g. --component app/components/Sidebar.', fromRoot);
  }
  return `${fromRoot}/${CONSTANTS_FILE}`;
}

/** Parses the JSON value of --value or --file. */
export async function readConstantValue(root: string, input: ConstantValue): Promise<unknown> {
  if ((input.value === undefined) === (input.file === undefined)) {
    throw constantError('constant-value-missing', 'Give the value with --value or --file, not both.', 'E.g. --value 20, --value \'"Docs"\' or --file navigation.json.');
  }
  let text = input.value;
  if (input.file !== undefined) {
    text = await readFile(path.resolve(root, input.file), 'utf8').catch(() => undefined);
    if (text === undefined) throw constantError('constant-file-missing', `Cannot read "${input.file}".`, 'Check the path, relative to the project root.');
  }
  try {
    return JSON.parse(text!);
  } catch (error) {
    throw constantError(
      'constant-value-invalid',
      `The value is not valid JSON: ${(error as Error).message}.`,
      'A string needs its quotes, e.g. --value \'"Docs"\' (in Windows PowerShell 5: --value \'\\"Docs\\"\'), or put the value in a file and pass --file.',
    );
  }
}

function checkName(name: string): void {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    throw constantError('constant-name-invalid', `"${name}" is not a valid constant name.`, 'Use a JavaScript name, e.g. NAVIGATION or siteName.');
  }
}

/**
 * Plans a new constant. Its name must be unique in the project, so a name used in a component
 * always points to one constant, whichever constants files the component can see.
 */
export async function planConstantCreate(changes: ChangeSet, config: ResolvedConfig, owner: ConstantOwner, name: string, input: ConstantValue): Promise<ConstantResult> {
  checkName(name);
  const fileRel = await constantsFileOf(changes.root, config, owner);
  const value = await readConstantValue(changes.root, input);

  for (const otherRel of new Set([...(await allConstantsFiles(changes.root, config)), fileRel])) {
    const text = await changes.read(otherRel);
    if (text !== undefined && parseConstants(otherRel, text).constants.some((constant) => constant.name === name)) {
      throw otherRel === fileRel
        ? constantError('constant-exists', `${fileRel} already has the constant "${name}".`, 'Change it with "constant update", or choose another name.', fileRel)
        : constantError('constant-name-taken', `The constant "${name}" already exists in ${otherRel}.`, 'Constant names are unique in the project: choose another name.', otherRel);
    }
  }

  const declaration = `export const ${name} = ${toLiteral(value)};\n`;
  const text = await changes.read(fileRel);
  if (text === undefined) {
    changes.write(fileRel, declaration, { type: 'create', message: `constants, with "${name}"` });
  } else {
    changes.write(fileRel, `${text.replace(/\s*$/, '\n')}\n${declaration}`, { type: 'update', message: `added the constant "${name}"` });
  }
  return { name, file: fileRel };
}

async function findConstant(changes: ChangeSet, fileRel: string, name: string) {
  const text = await changes.read(fileRel);
  const parsed = text === undefined ? undefined : parseConstants(fileRel, text);
  const constant = parsed?.constants.find((candidate) => candidate.name === name);
  if (!text || !parsed || !constant) {
    throw constantError('constant-missing', `${fileRel} has no constant "${name}".`, 'Create it with "constant create", or check the name and the location.', fileRel);
  }
  return { text, sourceFile: parsed.sourceFile, constant };
}

/** Plans replacing the value of a constant. */
export async function planConstantUpdate(changes: ChangeSet, config: ResolvedConfig, owner: ConstantOwner, name: string, input: ConstantValue): Promise<ConstantResult> {
  checkName(name);
  const fileRel = await constantsFileOf(changes.root, config, owner);
  const value = await readConstantValue(changes.root, input);
  const { text, sourceFile, constant } = await findConstant(changes, fileRel, name);
  const initializer = constant.declaration.initializer!;
  const updated = `${text.slice(0, initializer.getStart(sourceFile))}${toLiteral(value)}${text.slice(initializer.getEnd())}`;
  changes.write(fileRel, updated, { type: 'update', message: `updated the constant "${name}"` });
  return { name, file: fileRel };
}

/** The files importing `name` from the constants file `fileRel`. */
async function importersOf(root: string, config: ResolvedConfig, fileRel: string, name: string): Promise<string[]> {
  const srcAbs = path.join(root, config.srcDir);
  const target = path.join(root, fileRel).replace(/\.ts$/, '');
  const importers: string[] = [];
  for (const file of (await listFiles(srcAbs)).filter(isCodeFile)) {
    const text = await readFile(file, 'utf8');
    if (!text.includes(name)) continue;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const imports = sourceFile.statements.some((statement) => {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return false;
      if (specifierPath(statement.moduleSpecifier.text, file, srcAbs, config.alias)?.base !== target) return false;
      const bindings = statement.importClause?.namedBindings;
      return !!bindings && ts.isNamedImports(bindings) && bindings.elements.some((element) => (element.propertyName ?? element.name).text === name);
    });
    if (imports) importers.push(toRelative(root, file));
  }
  return importers.sort();
}

/** Plans removing a constant that nothing imports. The constants file goes when it becomes empty. */
export async function planConstantRemove(changes: ChangeSet, config: ResolvedConfig, owner: ConstantOwner, name: string): Promise<ConstantResult> {
  checkName(name);
  const fileRel = await constantsFileOf(changes.root, config, owner);
  const { text, sourceFile, constant } = await findConstant(changes, fileRel, name);

  const importers = await importersOf(changes.root, config, fileRel, name);
  if (importers.length) {
    throw constantError('constant-in-use', `The constant "${name}" is used in ${importers.join(', ')}.`, 'Remove its uses first, then remove the constant.', fileRel);
  }
  if (constant.statement.declarationList.declarations.length > 1) {
    throw constantError('constant-shared-statement', `"${name}" is declared together with other constants.`, 'Split the declaration by hand, one constant per "export const".', fileRel);
  }

  const updated = cut(text, removalRange(text, constant.statement.getStart(sourceFile), constant.statement.getEnd()))
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+/, '');
  if (updated.trim() === '') changes.delete(fileRel, `removed "${name}", its last constant`);
  else changes.write(fileRel, updated, { type: 'update', message: `removed the constant "${name}"` });
  return { name, file: fileRel };
}
