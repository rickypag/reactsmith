import { readdir } from 'node:fs/promises';
import path from 'node:path';

/** Folders never scanned for project files. */
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out']);

/** Lists every file under `dir` (absolute paths), skipping dependencies, build output and dot-folders. */
export async function listFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return files;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      files.push(...(await listFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/** Project-relative path with forward slashes, for messages and JSON output. */
export function toRelative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}
