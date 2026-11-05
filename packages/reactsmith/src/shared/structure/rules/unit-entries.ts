import type { Dirent } from 'node:fs';
import { CONFIG_FILE, STYLE_FILE_SUFFIXES } from '../../config/defaults.js';
import type { ResolvedConfig } from '../../config/types.js';
import type { Issue } from '../../issues.js';
import type { TreeUnit } from '../../tree/types.js';

/** Folders every unit folder may hold: tests and stories, with any content (v1 has no rules for them). */
export const FREE_FOLDERS = ['tests', 'stories'] as const;

const STYLE_FILE = /\.(css|scss|sass|less)$|\.styles\.ts$|\.css\.ts$/;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const STORY_FILE = /\.stories\.[jt]sx?$/;

/** What a unit folder may hold directly, and what to say about the rest. */
export interface UnitEntryPolicy {
  /** The code for an entry the folder does not allow: "component-unexpected-file". */
  code: string;
  files: readonly string[];
  /** Its folders besides tests/ and stories/: api/ for components and views. */
  folders: readonly string[];
  /** Where other files belong. */
  fileHint: string;
  /** Where the code of other folders belongs. */
  folderHint: string;
}

/** The style file of a unit file in the configured format: "UserCard.module.css" for "UserCard.tsx". */
export function styleFileOf(config: ResolvedConfig, fileName: string): string {
  return fileName.replace(/\.tsx$/, STYLE_FILE_SUFFIXES[config.styles]);
}

function fileHint(config: ResolvedConfig, unit: TreeUnit, fileName: string, policy: UnitEntryPolicy): string {
  if (TEST_FILE.test(fileName)) return `Move it to ${unit.folderRel}/tests/${fileName}.`;
  if (STORY_FILE.test(fileName)) return `Move it to ${unit.folderRel}/stories/${fileName}.`;
  if (STYLE_FILE.test(fileName)) {
    return `Styles are ${config.styles} ("styles" in ${CONFIG_FILE}): each ${unit.kind} file has its own, e.g. ${styleFileOf(config, `${unit.name}.tsx`)} for ${unit.name}.tsx.`;
  }
  return policy.fileHint;
}

/** The entries of a unit folder that its policy does not allow: one code, with "File" or "Folder" in the message. */
export function unitEntryIssues(config: ResolvedConfig, unit: TreeUnit, entries: Dirent[], policy: UnitEntryPolicy): Issue[] {
  const folders = [...policy.folders, ...FREE_FOLDERS];
  return entries.flatMap((entry): Issue[] => {
    const isFolder = entry.isDirectory();
    if (isFolder ? folders.includes(entry.name) : policy.files.includes(entry.name)) return [];
    return [{
      severity: 'error',
      code: policy.code,
      path: `${unit.folderRel}/${entry.name}`,
      message: `${isFolder ? 'Folder' : 'File'} "${entry.name}" is not allowed in ${unit.kind} "${unit.name}".`,
      hint: isFolder
        ? `A ${unit.kind} folder only has the folders ${folders.map((folder) => `${folder}/`).join(', ')}. ${policy.folderHint}`
        : fileHint(config, unit, entry.name, policy),
    }];
  });
}
