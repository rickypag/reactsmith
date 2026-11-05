import path from 'node:path';
import { componentTypes } from '../../../components/scope.js';
import { CONFIG_FILE } from '../../../config/defaults.js';
import type { ResolvedConfig } from '../../../config/types.js';
import { readDir } from '../../../files.js';
import type { Issue, Severity } from '../../../issues.js';
import { caseHint } from './unknown-folders.js';

/** A component folder name: "PrimaryButton". */
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/;

/**
 * The shared components folder: only one folder per type of "componentTypes", following the unknownFolders policy.
 * What is inside each type folder is the components rule's.
 */
export async function sharedComponentsIssues(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const folder = config.tree.src.folders.find((candidate) => candidate.holds === 'components');
  if (!folder || config.unknownFolders === 'allow') return [];
  const severity: Severity = config.unknownFolders === 'error' ? 'error' : 'warning';
  const sharedRel = `${config.tree.srcDir}/${folder.name}`;
  const types = componentTypes(config);

  return ((await readDir(path.join(root, sharedRel))) ?? [])
    .filter((entry) => entry.isDirectory() && !types.includes(entry.name))
    .map((entry) => {
      const component = COMPONENT_NAME.test(entry.name) && !types.some((type) => type.toLowerCase() === entry.name.toLowerCase());
      return {
        severity,
        code: 'unknown-component-type',
        path: `${sharedRel}/${entry.name}`,
        message: component
          ? `"${entry.name}" is directly in ${sharedRel}/, but each shared component lives in the folder of its type.`
          : `"${entry.name}" is not a type of shared components.`,
        hint: component
          ? `Move it into its type, e.g. ${sharedRel}/buttons/${entry.name}, and export it from the type's index.ts.`
          : caseHint(entry.name, types) ?? `Use one of: ${types.join(', ')}. Or add it to "componentTypes" in ${CONFIG_FILE}.`,
      };
    });
}
