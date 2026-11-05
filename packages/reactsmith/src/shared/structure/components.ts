import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedConfig } from '../config/types.js';
import { findSpecifiers, specifierPath } from '../imports/specifiers.js';
import type { Issue } from '../issues.js';
import { API_FOLDER } from './api.js';
import { listUnits } from '../tree/list-units.js';
import { componentEntryProblems, componentFileProblems } from './component-file.js';
import { childrenIssues } from './children.js';
import { componentStyleIssues } from './component-styles.js';
import { inlineStyleIssues } from './inline-styles.js';
import { plainLinkIssues } from './links.js';
import { tableNestingIssues } from '../elements/table.js';
import { listShapeIssues } from './lists.js';
import { textPlacementIssues } from './text.js';

/** The UI of a component that loads data: props in, JSX out. */
export const CONTENT_SUFFIX = 'Content';

/** The placeholder a component that loads data shows while loading. */
export const SKELETON_SUFFIX = 'Skeleton';

/** Files a component folder may hold besides its component files and api/. */
export const COMPONENT_EXTRA_FILES = ['index.ts', 'types.ts', 'utils.ts', 'constants.ts'] as const;

const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;

const COMPONENT_FILE_HINT =
  'A component file holds only the component (an arrow function typed React.FC) and, if needed, its props interface. ' +
  'Move types to types.ts, helpers to utils.ts and constants to constants.ts (with "constant create").';

async function readOptional(file: string): Promise<string | undefined> {
  return readFile(file, 'utf8').catch(() => undefined);
}

/** Problems with `fileName`'s content and, for Content and Skeleton, its imports from api/. */
async function checkComponentFile(
  root: string,
  config: ResolvedConfig,
  folderRel: string,
  fileName: string,
  name: string,
  issues: Issue[],
): Promise<void> {
  const fileRel = `${folderRel}/${fileName}`;
  const text = await readOptional(path.join(root, fileRel));
  if (text === undefined) return;
  issues.push(...textPlacementIssues(root, config, fileRel, text), ...listShapeIssues(fileRel, text), ...plainLinkIssues(config, fileRel, text), ...tableNestingIssues(fileRel, text), ...inlineStyleIssues(config, fileRel, text));
  issues.push(...(await componentStyleIssues(root, config, fileRel, text, fileName.replace(/\.[jt]sx$/, ''))));
  issues.push(...childrenIssues(fileRel, text, fileName.replace(/\.[jt]sx$/, '')));
  for (const problem of componentFileProblems(text, fileName, name)) {
    issues.push({ severity: 'error', code: 'component-file-content', path: fileRel, message: problem, hint: COMPONENT_FILE_HINT });
  }

  if (!name.endsWith(CONTENT_SUFFIX) && !name.endsWith(SKELETON_SUFFIX)) return;
  const file = path.join(root, fileRel);
  const apiDir = path.join(root, folderRel, API_FOLDER);
  for (const specifier of findSpecifiers(text)) {
    const base = specifierPath(specifier.value, file, path.join(root, config.srcDir), config.alias)?.base;
    if (base === undefined || (base !== apiDir && !base.startsWith(apiDir + path.sep))) continue;
    const main = folderRel.split('/').pop()!;
    issues.push({
      severity: 'error',
      code: 'component-content-imports-api',
      path: fileRel,
      message: `${name} imports "${specifier.value}", but only ${main}.tsx may use ${API_FOLDER}/.`,
      hint: `Call the query or mutation in ${main}.tsx and pass the data and callbacks to ${name} as props.`,
    });
  }
}

/**
 * The content checks of every component folder, until the content rules take them: the component files and the entry
 * point. Where the folders are and what is in them is the components rule's.
 */
export async function checkComponentContents(root: string, config: ResolvedConfig, issues: Issue[]): Promise<void> {
  for (const unit of await listUnits(root, config)) {
    if (unit.kind !== 'component' || !COMPONENT_NAME.test(unit.name)) continue;
    const { name, folderRel } = unit;
    for (const component of [name, `${name}${CONTENT_SUFFIX}`, `${name}${SKELETON_SUFFIX}`]) {
      await checkComponentFile(root, config, folderRel, `${component}.tsx`, component, issues);
    }

    const entryRel = `${folderRel}/index.ts`;
    const entryText = await readOptional(path.join(root, entryRel));
    for (const problem of entryText === undefined ? [] : componentEntryProblems(entryText, 'index.ts', name)) {
      issues.push({
        severity: 'error',
        code: 'component-entry-invalid',
        path: entryRel,
        message: problem,
        hint: `It should only contain "export { ${name} } from './${name}';" (and the ${name}Props type, if needed).`,
      });
    }

  }
}
