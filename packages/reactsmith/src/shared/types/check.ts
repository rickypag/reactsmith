import { existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { TSCONFIG_FILES } from '../alias/tsconfig.js';
import { IssueError } from '../issues.js';

/** Compiler options when the project has no usable tsconfig: what a Vite React project uses. */
const FALLBACK_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
};

/** Library and package types don't change during a run: parsed once, shared by every check. */
const declarationCache = new Map<string, ts.SourceFile>();

/** Diagnostics meaning the project has no React types to check against, so nothing can be said about props. */
const NO_REACT_TYPES = new Set([7026, 2875]);

/** The project's compiler options and its declaration files (e.g. vite-env.d.ts), from the first tsconfig found. */
function projectOptions(root: string): { options: ts.CompilerOptions; declarations: string[] } {
  for (const name of TSCONFIG_FILES) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    const { config, error } = ts.readConfigFile(file, ts.sys.readFile);
    if (error || !config) continue;
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root, undefined, file);
    // A tsconfig that only references others (Vite's tsconfig.json) has no options of its own.
    if (parsed.options.jsx === undefined) continue;
    return { options: parsed.options, declarations: parsed.fileNames.filter((fileName) => fileName.endsWith('.d.ts')) };
  }
  return { options: FALLBACK_OPTIONS, declarations: [] };
}

export interface TypeError {
  message: string;
  /** Where the error starts in the checked text. */
  start: number;
}

/**
 * Type-checks a file of the project as it will be, with `text` as its content, using the project's tsconfig
 * and installed types. Returns the errors between `start` and `end` (the new element), or undefined when the
 * project has no React types, so there is nothing to check against.
 */
export function typeErrorsIn(
  root: string,
  fileRel: string,
  text: string,
  start: number,
  end: number,
  /** Other files as they will be, by project-relative path: e.g. a component whose props change in the same command. */
  pending: Map<string, string> = new Map(),
): TypeError[] | undefined {
  const file = path.join(root, fileRel);
  const { options: projectOpts, declarations } = projectOptions(root);
  const options: ts.CompilerOptions = { ...projectOpts, noEmit: true, skipLibCheck: true, noUnusedLocals: false, noUnusedParameters: false };
  const normalized = path.normalize(file);
  const contents = new Map([...pending].map(([rel, content]) => [path.normalize(path.join(root, rel)), content]));
  contents.set(normalized, text);

  const host = ts.createCompilerHost(options, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    const content = contents.get(path.normalize(fileName));
    if (content !== undefined) return ts.createSourceFile(fileName, content, languageVersion, true, ts.ScriptKind.TSX);
    const cacheable = fileName.endsWith('.d.ts');
    const cached = cacheable ? declarationCache.get(fileName) : undefined;
    if (cached) return cached;
    const sourceFile = defaultGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (cacheable && sourceFile) declarationCache.set(fileName, sourceFile);
    return sourceFile;
  };
  const defaultFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => contents.has(path.normalize(fileName)) || defaultFileExists(fileName);
  const defaultReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => contents.get(path.normalize(fileName)) ?? defaultReadFile(fileName);

  const program = ts.createProgram({ rootNames: [file, ...declarations], options, host });
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) return undefined;
  const diagnostics = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
  if (diagnostics.some((diagnostic) => NO_REACT_TYPES.has(diagnostic.code))) return undefined;

  return diagnostics
    .filter((diagnostic) => diagnostic.start !== undefined && diagnostic.start >= start && diagnostic.start < end)
    .map((diagnostic) => ({ message: deepestMessage(diagnostic.messageText), start: diagnostic.start! }));
}

/** The most specific line of a TypeScript message: "Property 'href' does not exist on type …" rather than the whole chain. */
function deepestMessage(message: string | ts.DiagnosticMessageChain): string {
  let current = message;
  while (typeof current !== 'string' && current.next?.[0]) current = current.next[0];
  return typeof current === 'string' ? current : current.messageText;
}

/**
 * The names a module exports, as its types say: "react-router" → NavLink, Link…
 * Undefined when the module or its types can't be found.
 */
export function moduleExports(root: string, specifiers: string[]): Map<string, Set<string> | undefined> {
  // Packages don't change during a run: each one is read once, however many steps ask.
  const missing = specifiers.filter((specifier) => !exportsCache.has(`${root}\0${specifier}`));
  if (missing.length) {
    for (const [specifier, exported] of readModuleExports(root, missing)) exportsCache.set(`${root}\0${specifier}`, exported);
  }
  return new Map(specifiers.map((specifier) => [specifier, exportsCache.get(`${root}\0${specifier}`)]));
}

const exportsCache = new Map<string, Set<string> | undefined>();

function readModuleExports(root: string, specifiers: string[]): Map<string, Set<string> | undefined> {
  const { options: projectOpts } = projectOptions(root);
  const options: ts.CompilerOptions = { ...projectOpts, noEmit: true, skipLibCheck: true };
  const probe = path.join(root, '__reactsmith_exports__.ts');
  const text = specifiers.map((specifier, index) => `import * as m${index} from ${JSON.stringify(specifier)};`).join('\n');

  const host = ts.createCompilerHost(options, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (path.normalize(fileName) === path.normalize(probe)) return ts.createSourceFile(fileName, text, languageVersion, true);
    const cached = fileName.endsWith('.d.ts') ? declarationCache.get(fileName) : undefined;
    if (cached) return cached;
    const sourceFile = defaultGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (sourceFile && fileName.endsWith('.d.ts')) declarationCache.set(fileName, sourceFile);
    return sourceFile;
  };
  const defaultFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => path.normalize(fileName) === path.normalize(probe) || defaultFileExists(fileName);

  const program = ts.createProgram({ rootNames: [probe], options, host });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(probe);
  const result = new Map<string, Set<string> | undefined>();
  specifiers.forEach((specifier, index) => {
    const statement = sourceFile?.statements[index];
    const symbol = statement && ts.isImportDeclaration(statement) ? checker.getSymbolAtLocation(statement.moduleSpecifier) : undefined;
    result.set(specifier, symbol ? new Set(checker.getExportsOfModule(symbol).map((exported) => exported.name)) : undefined);
  });
  return result;
}

const childrenCache = new Map<string, boolean | undefined>();

/**
 * Whether a package's component takes children, as its types say: React's Suspense and next-intl's Link do, next/image's
 * Image doesn't. Undefined when its types can't be found.
 */
export function packageTakesChildren(root: string, specifier: string, name: string): boolean | undefined {
  const key = `${root}\0${specifier}\0${name}`;
  if (childrenCache.has(key)) return childrenCache.get(key);
  const { options: projectOpts } = projectOptions(root);
  const options: ts.CompilerOptions = { ...projectOpts, noEmit: true, skipLibCheck: true };
  const probe = path.join(root, '__reactsmith_children__.tsx');
  const imported = name === 'default' ? `import Probe from ${JSON.stringify(specifier)};` : `import { ${name} as Probe } from ${JSON.stringify(specifier)};`;
  const text = `${imported}\nimport type { ComponentProps } from 'react';\nexport type ProbeProps = ComponentProps<typeof Probe>;\n`;

  const host = ts.createCompilerHost(options, true);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
    if (path.normalize(fileName) === path.normalize(probe)) return ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TSX);
    const cached = fileName.endsWith('.d.ts') ? declarationCache.get(fileName) : undefined;
    if (cached) return cached;
    const sourceFile = defaultGetSourceFile(fileName, languageVersion, onError, shouldCreate);
    if (sourceFile && fileName.endsWith('.d.ts')) declarationCache.set(fileName, sourceFile);
    return sourceFile;
  };
  const defaultFileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => path.normalize(fileName) === path.normalize(probe) || defaultFileExists(fileName);

  const program = ts.createProgram({ rootNames: [probe], options, host });
  const sourceFile = program.getSourceFile(probe);
  let result: boolean | undefined;
  if (sourceFile && program.getSemanticDiagnostics(sourceFile).length === 0) {
    const checker = program.getTypeChecker();
    const alias = sourceFile.statements.find(ts.isTypeAliasDeclaration);
    const type = alias && checker.getTypeAtLocation(alias.name);
    result = type ? checker.getPropertyOfType(type, 'children') !== undefined : undefined;
  }
  childrenCache.set(key, result);
  return result;
}

/**
 * Refuses an element whose props TypeScript rejects: an unknown prop, a wrong value, a required one missing.
 * `jsx` is the new element as written in `text`. Nothing is checked when the project has no React types.
 */
/** Files whose type checks were put off, while a run of several steps defers them to one check at the end. */
let deferred: Set<string> | undefined;

/** Puts off the type checks of new elements until `takeDeferredTypeChecks`: one check for many steps. */
export function deferTypeChecks(): void {
  deferred = new Set();
}

/** Stops deferring, and returns the project-relative files that still need their type check. */
export function takeDeferredTypeChecks(): string[] {
  const files = [...(deferred ?? [])];
  deferred = undefined;
  return files;
}

export function assertValidJsx(root: string, fileRel: string, text: string, jsx: string, tag: string, pending?: Map<string, string>): void {
  if (deferred) {
    deferred.add(fileRel);
    return;
  }
  const start = text.indexOf(jsx);
  if (start === -1) return;
  const errors = typeErrorsIn(root, fileRel, text, start, start + jsx.length, pending);
  if (!errors?.length) return;
  throw new IssueError({
    severity: 'error',
    code: 'element-props-invalid',
    path: fileRel,
    message: `<${tag}> would not compile: ${errors[0]!.message}`,
    hint: "Check the props: the element's TypeScript types say which ones it takes.",
  });
}
