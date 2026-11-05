import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { appIssues } from './app-issues.js';
import { featureIssues } from './feature-issues.js';
import { sharedComponentsIssues } from './shared-components-issues.js';

/**
 * File placement: the files directly in each folder the convention shapes are the ones it allows there. No files in
 * features/, views/, layouts/ and components/ (one folder per unit), only the barrel in a type of shared components,
 * and the place files plus constants.ts at the app and feature roots. Code and free folders take any file. What is
 * inside each unit folder, and the content of files, belong to other rules.
 */
export async function checkFilePlacement(root: string, config: ResolvedConfig): Promise<Issue[]> {
  return [
    ...(await sharedComponentsIssues(root, config)),
    ...(await appIssues(root, config)),
    ...(await featureIssues(root, config)),
  ];
}
