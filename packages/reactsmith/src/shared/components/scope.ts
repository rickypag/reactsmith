import { CONFIG_FILE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';

/** Who a component belongs to: a feature, or the app shell (layout, top bar…). */
export type ComponentOwner = { feature: string } | { app: true };

export interface ComponentScope {
  /** 'feature "docs"' or "the app", for messages. */
  label: string;
  /** The folder the owner's code lives in: "src/features/docs" or "src/app". */
  scopeRel: string;
  /** The owner's components folder: "src/features/docs/components" or "src/app/components". */
  componentsRel: string;
}

function scopeError(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

/** The owner from the --feature and --app options: exactly one of them. */
export function ownerFromOptions(feature: string | undefined, app: boolean | undefined): ComponentOwner {
  if (feature !== undefined && app) {
    throw scopeError('options-conflict', '--feature and --app cannot be used together.', 'A component belongs to one feature, or to the app.');
  }
  if (app) return { app: true };
  if (feature !== undefined) return { feature };
  throw scopeError('owner-missing', 'Say who the component belongs to.', 'Pass --feature <name> for a feature component, or --app for an app component (layout, top bar…).');
}

export function componentScope(config: ResolvedConfig, owner: ComponentOwner): ComponentScope {
  if ('feature' in owner) {
    const scopeRel = `${config.srcDir}/${config.folders.features}/${owner.feature}`;
    return { label: `feature "${owner.feature}"`, scopeRel, componentsRel: `${scopeRel}/${config.featureFolders.components}` };
  }
  if (!config.folders.app || !config.appFolders.components) {
    throw scopeError('app-components-disabled', 'App components are disabled.', `Set "folders.app" and "appFolders.components" in ${CONFIG_FILE}.`);
  }
  const scopeRel = `${config.srcDir}/${config.folders.app}`;
  return { label: 'the app', scopeRel, componentsRel: `${scopeRel}/${config.appFolders.components}` };
}
