import { CONFIG_FILE } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { IssueError } from '../issues.js';

/** Who a component belongs to: a feature, the app shell (layout, top bar…), or a type of shared components ("buttons"). */
export type ComponentOwner = { feature: string } | { app: true } | { type: string };

export interface ComponentScope {
  /** 'feature "docs"', "the app" or 'the shared "buttons"', for messages. */
  label: string;
  /** The folder the owner's code lives in: "src/features/docs", "src/app" or "src/components". */
  scopeRel: string;
  /** The folder holding the owner's component folders: "src/features/docs/components", "src/components/buttons". */
  componentsRel: string;
}

function scopeError(code: string, message: string, hint: string): IssueError {
  return new IssueError({ severity: 'error', code, message, hint });
}

/** Every type of shared components, from all groups of "componentTypes". */
export function componentTypes(config: ResolvedConfig): string[] {
  return Object.values(config.componentTypes).flat();
}

/** The owner from the --feature, --app and --type options: exactly one of them. */
export function ownerFromOptions(feature: string | undefined, app: boolean | undefined, type?: string): ComponentOwner {
  const given = [feature !== undefined && '--feature', app && '--app', type !== undefined && '--type'].filter(Boolean);
  if (given.length > 1) {
    throw scopeError('options-conflict', `${given.join(' and ')} cannot be used together.`, 'A component belongs to one feature, to the app, or to one type of shared components.');
  }
  if (app) return { app: true };
  if (feature !== undefined) return { feature };
  if (type !== undefined) return { type };
  throw scopeError(
    'owner-missing',
    'Say who the component belongs to.',
    'Pass --feature <name> for a feature component, --app for an app component (layout, top bar…), or --type <type> for a shared component (e.g. --type buttons).',
  );
}

export function componentScope(config: ResolvedConfig, owner: ComponentOwner): ComponentScope {
  if ('feature' in owner) {
    const scopeRel = `${config.srcDir}/${config.folders.features}/${owner.feature}`;
    return { label: `feature "${owner.feature}"`, scopeRel, componentsRel: `${scopeRel}/${config.featureFolders.components}` };
  }
  if ('type' in owner) {
    const types = componentTypes(config);
    if (!types.includes(owner.type)) {
      throw scopeError(
        'unknown-component-type',
        `"${owner.type}" is not a type of shared components.`,
        `Use one of: ${types.join(', ')}. Or add it to "componentTypes" in ${CONFIG_FILE}.`,
      );
    }
    const scopeRel = `${config.srcDir}/${config.folders.components}`;
    return { label: `the shared "${owner.type}"`, scopeRel, componentsRel: `${scopeRel}/${owner.type}` };
  }
  if (!config.folders.app || !config.appFolders.components) {
    throw scopeError('app-components-disabled', 'App components are disabled.', `Set "folders.app" and "appFolders.components" in ${CONFIG_FILE}.`);
  }
  const scopeRel = `${config.srcDir}/${config.folders.app}`;
  return { label: 'the app', scopeRel, componentsRel: `${scopeRel}/${config.appFolders.components}` };
}
