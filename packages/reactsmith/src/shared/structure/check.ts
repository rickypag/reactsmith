import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_FILE, TOOL_NAME } from '../config/defaults.js';
import { loadConfig } from '../config/load.js';
import type { ResolvedConfig } from '../config/types.js';
import type { Issue, Severity } from '../issues.js';
import { matchesNaming, toNaming } from '../naming.js';
import { APP_FILE_PATTERN, srcMissingIssue } from './app-files.js';

export interface CheckResult {
  root: string;
  configFound: boolean;
  issues: Issue[];
}

async function readDir(dir: string): Promise<Dirent[] | undefined> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Suggests the configured name when a folder only differs by case, e.g. "Components" vs "components". */
function caseHint(name: string, known: string[]): string | undefined {
  const match = known.find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return match ? `Folder names are case-sensitive: rename it to "${match}".` : undefined;
}

function unknownFolderIssue(
  severity: Severity,
  relPath: string,
  message: string,
  configKey: 'folders' | 'featureFolders',
  name: string,
  known: string[],
): Issue {
  return {
    severity,
    code: configKey === 'folders' ? 'unknown-folder' : 'unknown-feature-folder',
    path: relPath,
    message,
    hint:
      caseHint(name, known) ??
      `Remove or rename it, or add it to "${configKey}" in ${CONFIG_FILE}, e.g. "${name}": "${name}".`,
  };
}

function checkSrcRoot(config: ResolvedConfig, entries: Dirent[], issues: Issue[]): void {
  const { srcDir, folders, unknownFolders } = config;
  const knownNames = Object.values(folders);
  const known = new Set(knownNames);

  if (unknownFolders !== 'allow') {
    for (const entry of entries) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      issues.push(
        unknownFolderIssue(
          unknownFolders === 'error' ? 'error' : 'warning',
          `${srcDir}/${entry.name}`,
          `Unknown folder "${entry.name}" in ${srcDir}/.`,
          'folders',
          entry.name,
          knownNames,
        ),
      );
    }
  }

  const appFiles = entries.filter((entry) => entry.isFile() && APP_FILE_PATTERN.test(entry.name)).map((entry) => entry.name);
  if (appFiles.length === 0) return;
  const fileList = appFiles.join(', ');

  if (config.appFiles === 'app') {
    issues.push({
      severity: 'error',
      code: 'app-files-location',
      path: srcDir,
      message: `${fileList} must be in ${srcDir}/${folders.app}/, not in ${srcDir}/.`,
      hint: `Run "${TOOL_NAME} init" to move them and update their imports, or set "appFiles": "root" in ${CONFIG_FILE}.`,
    });
  } else if (config.appFiles === undefined) {
    issues.push({
      severity: 'warning',
      code: 'app-files-undecided',
      path: srcDir,
      message: `${fileList} ${appFiles.length === 1 ? 'is' : 'are'} in ${srcDir}/ and "appFiles" is not set.`,
      hint: `Run "${TOOL_NAME} init" to choose, or set "appFiles" in ${CONFIG_FILE} to "app" (move them to ${srcDir}/${folders.app ?? 'app'}/) or "root" (keep them where they are).`,
    });
  }
}

async function checkFeatures(root: string, config: ResolvedConfig, issues: Issue[]): Promise<void> {
  const { srcDir, folders, featureFolders, featureNaming, unknownFolders } = config;
  const featuresRel = `${srcDir}/${folders.features}`;
  const entries = await readDir(path.join(root, featuresRel));
  if (!entries) return;

  const knownNames = Object.values(featureFolders);
  const known = new Set(knownNames);

  for (const entry of entries) {
    const entryRel = `${featuresRel}/${entry.name}`;

    if (!entry.isDirectory()) {
      issues.push({
        severity: 'error',
        code: 'unexpected-file',
        path: entryRel,
        message: `"${entry.name}" is a file, but ${featuresRel}/ may only contain feature folders.`,
        hint: 'Move it into a feature folder or into a shared folder.',
      });
      continue;
    }

    if (!matchesNaming(entry.name, featureNaming)) {
      issues.push({
        severity: 'error',
        code: 'feature-naming',
        path: entryRel,
        message: `Feature "${entry.name}" does not follow ${featureNaming}.`,
        hint: `Rename it to "${toNaming(entry.name, featureNaming)}", or change "featureNaming" in ${CONFIG_FILE}.`,
      });
    }

    if (unknownFolders === 'allow') continue;
    const children = (await readDir(path.join(root, entryRel))) ?? [];
    for (const child of children) {
      if (!child.isDirectory() || known.has(child.name)) continue;
      issues.push(
        unknownFolderIssue(
          unknownFolders === 'error' ? 'error' : 'warning',
          `${entryRel}/${child.name}`,
          `Unknown folder "${child.name}" in feature "${entry.name}".`,
          'featureFolders',
          child.name,
          knownNames,
        ),
      );
    }
  }
}

/** Validates the project at `root` against its config. Never modifies files. */
export async function checkStructure(root: string): Promise<CheckResult> {
  const { found, config, issues } = await loadConfig(root);
  if (!config) return { root, configFound: found, issues };

  const srcEntries = await readDir(path.join(root, config.srcDir));
  if (!srcEntries) {
    issues.push(srcMissingIssue(config));
    return { root, configFound: found, issues };
  }

  checkSrcRoot(config, srcEntries, issues);
  await checkFeatures(root, config, issues);
  return { root, configFound: found, issues };
}
