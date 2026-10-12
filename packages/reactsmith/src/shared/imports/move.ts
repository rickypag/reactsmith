import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSet, FileMove } from '../changes.js';
import { listFiles } from '../files.js';
import { IssueError } from '../issues.js';
import { CODE_EXTENSIONS, findSpecifiers, isCodeFile } from './specifiers.js';

export interface MoveContext {
  /** Absolute source folder that the alias points to. */
  srcDir: string;
  /** Import alias for srcDir, e.g. "@" for "@/components/Button". */
  alias?: string;
}

export interface ImportUpdate {
  /** The importing file, at its location after the move. */
  file: string;
  from: string;
  to: string;
}

export interface MovePlan {
  /** File-level moves: folder moves are expanded to every file inside. */
  moves: FileMove[];
  updates: ImportUpdate[];
}

function moveError(message: string): IssueError {
  return new IssueError({ severity: 'error', code: 'move-failed', message });
}

type ResolutionKind = 'exact' | 'ext-added' | 'js-to-ts' | 'dir-index';

interface Resolution {
  target: string;
  kind: ResolutionKind;
  style: 'relative' | 'alias';
  /** Original extension when a ".js" specifier points to a ".ts" file. */
  jsExt?: string;
  /** Query or hash suffix such as "?raw", kept as is. */
  suffix: string;
}

const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
};

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isRelative(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

/** Resolves a specifier to a project file, remembering how it was written so it can be rewritten in the same style. */
function resolveSpecifier(value: string, importer: string, ctx: MoveContext, files: Set<string>): Resolution | undefined {
  const suffixAt = value.search(/[?#]/);
  const bare = suffixAt === -1 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt === -1 ? '' : value.slice(suffixAt);

  let base: string;
  let style: Resolution['style'];
  if (isRelative(bare)) {
    base = path.resolve(path.dirname(importer), bare);
    style = 'relative';
  } else if (ctx.alias && bare.startsWith(`${ctx.alias}/`)) {
    base = path.resolve(ctx.srcDir, bare.slice(ctx.alias.length + 1));
    style = 'alias';
  } else {
    return undefined;
  }

  if (files.has(base)) return { target: base, kind: 'exact', style, suffix };
  for (const ext of CODE_EXTENSIONS) {
    if (files.has(base + ext)) return { target: base + ext, kind: 'ext-added', style, suffix };
  }
  const jsExt = path.extname(base);
  for (const tsExt of JS_TO_TS[jsExt] ?? []) {
    const candidate = base.slice(0, -jsExt.length) + tsExt;
    if (files.has(candidate)) return { target: candidate, kind: 'js-to-ts', style, jsExt, suffix };
  }
  for (const ext of CODE_EXTENSIONS) {
    const candidate = path.join(base, `index${ext}`);
    if (files.has(candidate)) return { target: candidate, kind: 'dir-index', style, suffix };
  }
  return undefined;
}

/** Writes a specifier pointing to `target` from `importer`, in the same style as the original. */
function buildSpecifier(resolution: Resolution, importer: string, target: string, ctx: MoveContext): string {
  let modulePath: string;
  switch (resolution.kind) {
    case 'exact':
      modulePath = target;
      break;
    case 'ext-added':
      modulePath = target.slice(0, -path.extname(target).length);
      break;
    case 'js-to-ts':
      modulePath = target.slice(0, -path.extname(target).length) + resolution.jsExt;
      break;
    case 'dir-index':
      modulePath = path.dirname(target);
      break;
  }

  if (resolution.style === 'alias' && ctx.alias && isInside(ctx.srcDir, modulePath)) {
    return `${ctx.alias}/${toPosix(path.relative(ctx.srcDir, modulePath))}${resolution.suffix}`;
  }
  let specifier = toPosix(path.relative(path.dirname(importer), modulePath)) || '.';
  if (!isRelative(specifier)) specifier = `./${specifier}`;
  return specifier + resolution.suffix;
}

async function expandRequests(requests: FileMove[]): Promise<{ moves: Map<string, string>; movedDirs: string[] }> {
  const moves = new Map<string, string>();
  const movedDirs: string[] = [];
  const targets = new Set<string>();

  for (const request of requests) {
    const from = path.resolve(request.from);
    const to = path.resolve(request.to);
    const fromStat = await stat(from).catch(() => undefined);
    if (!fromStat) throw moveError(`Cannot move "${from}": it does not exist.`);
    if (await stat(to).catch(() => undefined)) throw moveError(`Cannot move to "${to}": it already exists.`);
    if (isInside(from, to)) throw moveError(`Cannot move "${from}" into itself.`);

    const pairs: [string, string][] = fromStat.isDirectory()
      ? (await listFiles(from)).map((file) => [file, path.join(to, path.relative(from, file))])
      : [[from, to]];
    if (fromStat.isDirectory()) movedDirs.push(from);

    for (const [source, destination] of pairs) {
      if (targets.has(destination)) throw moveError(`Two files would be moved to "${destination}".`);
      targets.add(destination);
      moves.set(source, destination);
    }
  }
  return { moves, movedDirs };
}

/**
 * Plans moving files or folders and rewriting every import, anywhere in the project,
 * that points to them or out of them. The moves and new file contents are recorded in `changes`.
 */
export async function planMove(changes: ChangeSet, ctx: MoveContext, requests: FileMove[]): Promise<MovePlan> {
  const { moves, movedDirs } = await expandRequests(requests);
  const allFiles = await listFiles(changes.root);
  const files = new Set(allFiles);
  const updates: ImportUpdate[] = [];
  const contents = new Map<string, string>();

  for (const file of allFiles) {
    if (!isCodeFile(file)) continue;
    const text = await changes.read(file);
    if (text === undefined) continue;
    const newFile = moves.get(file) ?? file;
    const replacements: { start: number; end: number; value: string }[] = [];

    for (const specifier of findSpecifiers(text)) {
      const resolution = resolveSpecifier(specifier.value, file, ctx, files);
      if (!resolution) continue;
      const newTarget = moves.get(resolution.target);
      if (newFile === file && !newTarget) continue;

      const value = buildSpecifier(resolution, newFile, newTarget ?? resolution.target, ctx);
      if (value === specifier.value) continue;
      replacements.push({ start: specifier.start, end: specifier.end, value });
      updates.push({ file: newFile, from: specifier.value, to: value });
    }

    if (replacements.length === 0) continue;
    let updated = text;
    for (const { start, end, value } of replacements.reverse()) {
      updated = updated.slice(0, start) + value + updated.slice(end);
    }
    contents.set(newFile, updated);
  }

  const plan: MovePlan = { moves: [...moves].map(([from, to]) => ({ from, to })), updates };
  for (const move of plan.moves) changes.move(move);
  for (const [file, content] of contents) changes.writeSilently(file, content);
  for (const { file, from, to } of updates) {
    changes.report({ type: 'update', path: changes.relative(file), message: `import "${from}" → "${to}"` });
  }
  for (const dir of movedDirs) changes.removeIfEmpty(dir);
  return plan;
}
