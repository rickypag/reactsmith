import { mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeAction } from '../core/result.js';
import { toRelative } from './files.js';

export type { ChangeAction, ChangeType } from '../core/result.js';

/** A file or folder move, with absolute paths. */
export interface FileMove {
  from: string;
  to: string;
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Removes `dir` and its subfolders if they contain no files. */
async function removeEmptyDirs(dir: string): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => undefined);
  if (!entries) return;
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirs(path.join(dir, entry.name));
  }
  if ((await readdir(dir)).length === 0) await rmdir(dir);
}

/**
 * The files as they were before a run of several commands, so the run can be undone as a whole: every ChangeSet
 * applied while a journal is active records each file it is about to change, the first time.
 */
export class FileJournal {
  private readonly originals = new Map<string, string | undefined>();

  constructor(readonly root: string) {}

  async record(absPath: string): Promise<void> {
    if (!this.originals.has(absPath)) this.originals.set(absPath, await readOptional(absPath));
  }

  /** Puts every recorded file back as it was, deleting the ones that did not exist, and the folders they leave empty. */
  async restore(): Promise<void> {
    const created: string[] = [];
    for (const [file, content] of this.originals) {
      if (content === undefined) {
        await rm(file, { force: true });
        created.push(file);
      } else {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, content);
      }
    }
    for (const file of created) {
      let dir = path.dirname(file);
      while (dir.startsWith(this.root) && dir !== this.root && (await readdir(dir).catch(() => ['?'])).length === 0) {
        await rmdir(dir);
        dir = path.dirname(dir);
      }
    }
    this.originals.clear();
  }
}

let activeJournal: FileJournal | undefined;

/** Starts or stops recording the files the next applied changes touch. */
export function setJournal(journal: FileJournal | undefined): void {
  activeJournal = journal;
}

/**
 * Collects the changes planned by scripts, so a command can show them, apply them,
 * or skip applying them for a dry run. Nothing touches the disk until `apply()`.
 *
 * Scripts read files through `read()`, so they see the changes planned by earlier scripts.
 */
export class ChangeSet {
  readonly actions: ChangeAction[] = [];
  private readonly writes = new Map<string, string>();
  private readonly moves: FileMove[] = [];
  private readonly emptiedDirs: string[] = [];
  private readonly deletes = new Set<string>();

  constructor(readonly root: string) {}

  resolve(relPath: string): string {
    return path.resolve(this.root, relPath);
  }

  relative(absPath: string): string {
    return toRelative(this.root, absPath);
  }

  /** Reads a file as it will be after the planned changes. Undefined if it does not exist. */
  async read(relOrAbsPath: string): Promise<string | undefined> {
    const file = this.resolve(relOrAbsPath);
    if (this.deletes.has(file)) return undefined;
    const pending = this.writes.get(file);
    if (pending !== undefined) return pending;
    const source = this.moves.find((move) => move.to === file)?.from ?? file;
    if (this.moves.some((move) => move.from === file)) return undefined;
    return readOptional(source);
  }

  /** The files written so far, as they will be, by project-relative path: what a type check sees besides the file it checks. */
  pending(): Map<string, string> {
    return new Map([...this.writes].map(([file, content]) => [this.relative(file), content]));
  }

  write(relPath: string, content: string, action: { type: 'create' | 'update'; message: string }): void {
    this.writes.set(this.resolve(relPath), content);
    this.actions.push({ ...action, path: relPath });
  }

  /** Records new content without a report line, e.g. imports already reported by the caller. */
  writeSilently(absPath: string, content: string): void {
    this.writes.set(absPath, content);
  }

  move(move: FileMove): void {
    this.moves.push(move);
    this.actions.push({ type: 'move', path: this.relative(move.from), message: `→ ${this.relative(move.to)}` });
  }

  /**
   * Deletes a file, as it will be after the planned changes: a file planned to be moved is not moved but deleted
   * where it is now, and its move is no longer reported.
   */
  delete(relOrAbsPath: string, message: string): void {
    const file = this.resolve(relOrAbsPath);
    this.writes.delete(file);
    const moved = this.moves.findIndex((move) => move.to === file);
    const source = moved === -1 ? file : this.moves[moved]!.from;
    if (moved !== -1) {
      this.moves.splice(moved, 1);
      const reported = this.actions.findIndex((action) => action.type === 'move' && action.path === this.relative(source));
      if (reported !== -1) this.actions.splice(reported, 1);
    }
    this.deletes.add(source);
    this.actions.push({ type: 'delete', path: this.relative(source), message });
  }

  /** Marks a folder that becomes empty after the moves, to be removed. */
  removeIfEmpty(absDir: string): void {
    this.emptiedDirs.push(absDir);
  }

  skip(relPath: string, message: string): void {
    this.actions.push({ type: 'skip', path: relPath, message });
  }

  /** Records a step the user has to do by hand. */
  todo(relPath: string, message: string): void {
    this.actions.push({ type: 'todo', path: relPath, message });
  }

  report(action: ChangeAction): void {
    this.actions.push(action);
  }

  get hasChanges(): boolean {
    return this.writes.size > 0 || this.moves.length > 0 || this.deletes.size > 0;
  }

  async apply(): Promise<void> {
    if (activeJournal) {
      for (const { from, to } of this.moves) {
        await activeJournal.record(from);
        await activeJournal.record(to);
      }
      for (const file of [...this.writes.keys(), ...this.deletes]) await activeJournal.record(file);
    }
    for (const { from, to } of this.moves) {
      await mkdir(path.dirname(to), { recursive: true });
      await rename(from, to);
    }
    for (const [file, content] of this.writes) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
    for (const file of this.deletes) await rm(file, { force: true });
    for (const dir of this.emptiedDirs) await removeEmptyDirs(dir);
  }
}
