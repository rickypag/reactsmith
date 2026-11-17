import path from 'node:path';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue } from '../../../issues.js';
import { isNextFile, isPrivateFolder } from './next-files.js';

/** Where code found in Next's app folder belongs: a feature, the shared components, or a code folder. */
function elsewhere(config: ResolvedConfig): string {
  const { srcDir, folders } = config;
  const code = [folders.utils, folders.lib].filter(Boolean).map((name) => `${srcDir}/${name}/`);
  return [
    `components and views in a feature (${srcDir}/${folders.features}/<feature>/) or in ${srcDir}/${folders.components}/`,
    ...(code.length ? [`other code in ${code.join(' or ')}`] : []),
  ].join(', ');
}

/**
 * The folders of Next's app folder, from `dirRel` down: route folders of any name ("docs", "[slug]", "(marketing)",
 * "@modal") holding only Next's files. A private folder is reported once, without looking inside.
 */
export async function routeFolderIssues(root: string, config: ResolvedConfig, dirRel: string): Promise<Issue[]> {
  const entries = (await readDir(path.join(root, dirRel))) ?? [];
  const issues: Issue[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryRel = `${dirRel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!isPrivateFolder(entry.name)) {
        issues.push(...(await routeFolderIssues(root, config, entryRel)));
        continue;
      }
      issues.push({
        severity: 'error',
        code: 'next-private-folder',
        path: entryRel,
        message: `"${entry.name}" is a private folder in ${dirRel}/: Next's app folder holds only the pages, not their components.`,
        hint: `Move what it holds out of the app folder: ${elsewhere(config)}. The page then imports its view.`,
      });
    } else if (entry.isFile() && !isNextFile(entry.name)) {
      issues.push({
        severity: 'error',
        code: 'next-app-file',
        path: entryRel,
        message: `"${entry.name}" is not a file of Next.js: ${dirRel}/ holds only pages, layouts, routes, metadata files and CSS.`,
        hint: `Move it out of the app folder: ${elsewhere(config)}.`,
      });
    }
  }
  return issues;
}
