import type { CommandResult } from '../../core/result.js';
import { planAliasSetup } from '../../shared/alias/setup.js';
import { ChangeSet } from '../../shared/changes.js';
import { CONFIG_FILE, DEFAULT_COMPONENT_TYPES } from '../../shared/config/defaults.js';
import { requireConfig } from '../../shared/config/load.js';
import type { AppFilesLocation, ResolvedConfig, UserConfig } from '../../shared/config/types.js';
import { configHasKey, planConfigUpdate } from '../../shared/config/write.js';
import { hasErrors, IssueError } from '../../shared/issues.js';
import { planIconsDetection } from '../../shared/icons/library.js';
import { planLayoutDetection } from '../../shared/layout/detect.js';
import { planStylesDetection } from '../../shared/styles/detect.js';
import { planRouterDetection } from '../../shared/router/detect.js';
import { planAppRouterCreate } from '../../shared/routes/app-router.js';
import { planAppComponent } from '../../shared/app/starter.js';
import { planGlobalStyles } from '../../shared/styles/global.js';
import { planStyleableFiles } from '../../shared/styles/styleable.js';
import { findRootAppFiles, planAppFilesMove } from '../../shared/structure/app-files.js';
import { checkStructure } from '../../shared/structure/check.js';
import { hasSkill, planSkillInstall, SKILL_DIR } from '../../shared/skills/install.js';

export interface InitOptions {
  /** Answer to the App files question, for non-interactive use. */
  appFiles?: AppFilesLocation;
  /** Accept the defaults instead of asking. */
  yes?: boolean;
  /** Plan the changes without writing anything. */
  dryRun?: boolean;
  /** Leave out the skill for Claude Code. */
  noSkills?: boolean;
  /** Asks a yes/no question. Omitted when prompting is not possible. */
  confirm?: (question: string) => Promise<boolean>;
}

/** `issues` explains why init stopped, or holds the result of check once init has run. */
export type InitResult = Required<Pick<CommandResult, 'ok' | 'dryRun' | 'actions' | 'issues'>>;

/** Where the App files should live: from the config, the option, the defaults, or the user. */
async function decideAppFiles(config: ResolvedConfig, rootAppFiles: string[], options: InitOptions): Promise<AppFilesLocation> {
  if (config.appFiles) {
    if (options.appFiles && options.appFiles !== config.appFiles) {
      throw new IssueError({
        severity: 'error',
        code: 'app-files-conflict',
        path: CONFIG_FILE,
        message: `${CONFIG_FILE} already sets "appFiles" to "${config.appFiles}", but "${options.appFiles}" was requested.`,
        hint: `Change "appFiles" in ${CONFIG_FILE} if you want to switch.`,
      });
    }
    return config.appFiles;
  }
  if (options.appFiles) return options.appFiles;
  if (rootAppFiles.length === 0 || options.yes) return 'app';
  if (options.confirm) {
    const target = `${config.srcDir}/${config.folders.app ?? 'app'}/`;
    return (await options.confirm(`Move ${rootAppFiles.join(', ')} into ${target}?`)) ? 'app' : 'root';
  }
  throw new IssueError({
    severity: 'error',
    code: 'app-files-required',
    path: config.srcDir,
    message: `${rootAppFiles.join(', ')} ${rootAppFiles.length === 1 ? 'is' : 'are'} in ${config.srcDir}/ and "appFiles" is not set.`,
    hint: 'Pass --app-files app (move them into the app folder) or --app-files root (keep them), or --yes for the default (app).',
  });
}

/** Whether to add the skill for Claude Code: always kept up to date once there, else asked, else added. */
async function decideSkill(changes: ChangeSet, options: InitOptions): Promise<boolean> {
  if (options.noSkills) return false;
  if (await hasSkill(changes)) return true;
  if (options.yes || !options.confirm) return true;
  return options.confirm(`Add the ReactSmith skill for Claude Code to ${SKILL_DIR}, with a pointer to it in CLAUDE.md?`);
}

/**
 * Sets up a project: config file (App files location, router, layout components, styles), import alias, app router, global styles, the App component (replacing the Vite starter), the skill for Claude Code, then check.
 * Every step is a shared script; this only decides the order and the inputs.
 */
export async function runInit(root: string, options: InitOptions = {}): Promise<InitResult> {
  const dryRun = options.dryRun ?? false;
  const changes = new ChangeSet(root);

  try {
    const config = await requireConfig(root);
    const appFiles = await decideAppFiles(config, await findRootAppFiles(root, config), options);

    const values: Partial<UserConfig> = { appFiles };
    const router = await planRouterDetection(changes, config);
    if (router) values.router = router;
    const layoutComponents = await planLayoutDetection(changes);
    if (layoutComponents) values.layoutComponents = layoutComponents;
    const styles = await planStylesDetection(changes);
    if (styles) values.styles = styles;
    const icons = await planIconsDetection(changes);
    if (icons) values.icons = icons;
    // The types of shared components are written out, so the team sees them and can change them.
    if (!(await configHasKey(changes, 'componentTypes'))) {
      values.componentTypes = Object.fromEntries(Object.entries(DEFAULT_COMPONENT_TYPES).map(([group, types]) => [group, [...types]]));
    }

    await planConfigUpdate(changes, values);
    if (appFiles === 'app') await planAppFilesMove(changes, config);
    await planAliasSetup(changes, config);
    // The router and the styles may have been detected in this run, so they are not in `config` yet.
    const withRouter = { ...config, router: config.router ?? router, styles: styles ?? config.styles };
    await planAppRouterCreate(changes, withRouter);
    const globalStyles = await planGlobalStyles(changes, withRouter);
    await planStyleableFiles(changes, withRouter);
    await planAppComponent(changes, withRouter, appFiles, globalStyles);
    if (await decideSkill(changes, options)) await planSkillInstall(changes);
  } catch (error) {
    if (!(error instanceof IssueError)) throw error;
    return { ok: false, dryRun, actions: changes.actions, issues: error.issues };
  }

  if (dryRun) return { ok: true, dryRun, actions: changes.actions, issues: [] };

  await changes.apply();
  const { issues } = await checkStructure(root);
  return { ok: !hasErrors(issues), dryRun, actions: changes.actions, issues };
}
