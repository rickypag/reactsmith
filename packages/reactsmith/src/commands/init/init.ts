import type { CommandResult } from '../../core/result.js';
import { planAliasSetup } from '../../shared/alias/setup.js';
import { ChangeSet } from '../../shared/changes.js';
import { CONFIG_FILE, DEFAULT_COMPONENT_TYPES } from '../../shared/config/defaults.js';
import { requireConfig } from '../../shared/config/load.js';
import type { AppFilesLocation, ResolvedConfig, StyleLibrary, UserConfig } from '../../shared/config/types.js';
import { configHasKey, planConfigUpdate } from '../../shared/config/write.js';
import { hasErrors, IssueError, type Issue } from '../../shared/issues.js';
import { planIconsDetection } from '../../shared/icons/library.js';
import { planI18nDetection } from '../../shared/i18n/detect.js';
import { planLayoutDetection } from '../../shared/layout/detect.js';
import { planStylesDecision } from '../../shared/styles/detect.js';
import { planRouterDetection } from '../../shared/router/detect.js';
import { planAppRouterCreate } from '../../shared/routes/app-router.js';
import { planAppComponent } from '../../shared/app/starter.js';
import { planGlobalStyles } from '../../shared/styles/global.js';
import { planStyleableFiles } from '../../shared/styles/styleable.js';
import { findRootAppFiles, planAppFilesMove, srcMissingIssue } from '../../shared/structure/app-files.js';
import { planFrameworkDetection } from '../../shared/framework/detect.js';
import { planNextRootLayout } from '../../shared/app/next-layout.js';
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
  /** How the commands write styles; asked when Tailwind is installed and this is not given. */
  styles?: StyleLibrary;
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

/** Next.js routes the pages from its app folder, so a Next app gets no router: reported as a skipped step. */
function skipNextRouter(changes: ChangeSet): undefined {
  changes.skip('package.json', 'Next.js project: Next routes the pages from its app folder, so ReactSmith sets up no router and checks no routing');
  return undefined;
}

/** ReactSmith works in srcDir, so a Next app keeps its code there: in src/app, not in app/ at the root. */
function nextSrcMissingIssue(config: ResolvedConfig): Issue {
  return {
    ...srcMissingIssue(config),
    hint: `Keep the Next.js app in ${config.srcDir}/ ("create-next-app --src-dir", or move app/ into ${config.srcDir}/app/), or set "srcDir" in ${CONFIG_FILE}.`,
  };
}

/** Whether to add the skill for Claude Code: always kept up to date once there, else asked, else added. */
async function decideSkill(changes: ChangeSet, options: InitOptions): Promise<boolean> {
  if (options.noSkills) return false;
  if (await hasSkill(changes)) return true;
  if (options.yes || !options.confirm) return true;
  return options.confirm(`Add the ReactSmith skill for Claude Code to ${SKILL_DIR}, with a pointer to it in CLAUDE.md?`);
}

/**
 * Sets up a project: config file (framework, App files location, router, layout components, styles), import alias, app router, global styles, the App component (replacing the Vite starter), the skill for Claude Code, then check.
 * A Next.js app skips what Next does itself: no App files, no router, no Vite alias; its root layout gets the global styles.
 * Every step is a shared script; this only decides the order and the inputs.
 */
export async function runInit(root: string, options: InitOptions = {}): Promise<InitResult> {
  const dryRun = options.dryRun ?? false;
  const changes = new ChangeSet(root);
  const notes: Issue[] = [];

  try {
    const fileConfig = await requireConfig(root);
    const detected = await planFrameworkDetection(changes, fileConfig);
    // The framework shapes the defaults (a Next app's app folder is the shell), so a framework found now is resolved in.
    const config = detected.save ? await requireConfig(root, { framework: detected.framework }) : fileConfig;
    const next = detected.framework === 'next';
    const rootAppFiles = await findRootAppFiles(root, config).catch((error: unknown) => {
      throw next && error instanceof IssueError ? new IssueError(nextSrcMissingIssue(config)) : error;
    });
    // A Next app has no App component: its root layout takes that place, in Next's own app folder.
    const appFiles = next ? undefined : await decideAppFiles(config, rootAppFiles, options);

    const values: Partial<UserConfig> = {};
    if (detected.save) values.framework = detected.framework;
    if (appFiles) values.appFiles = appFiles;
    const router = next ? skipNextRouter(changes) : await planRouterDetection(changes, config);
    if (router) values.router = router;
    const layoutComponents = await planLayoutDetection(changes);
    if (layoutComponents) values.layoutComponents = layoutComponents;
    const decision = await planStylesDecision(changes, options.styles, options.yes ? undefined : options.confirm);
    const styles = decision.styles;
    notes.push(...decision.notes);
    if (styles) values.styles = styles;
    const icons = await planIconsDetection(changes);
    if (icons) values.icons = icons;
    const i18n = await planI18nDetection(changes, config);
    if (i18n) values.i18n = i18n;
    // The types of shared components are written out, so the team sees them and can change them.
    if (!(await configHasKey(changes, 'componentTypes'))) {
      values.componentTypes = Object.fromEntries(Object.entries(DEFAULT_COMPONENT_TYPES).map(([group, types]) => [group, [...types]]));
    }

    await planConfigUpdate(changes, values);
    if (appFiles === 'app') await planAppFilesMove(changes, config);
    // The framework, the router and the styles may have been detected in this run, so they are not in `config` yet.
    const detectedConfig = { ...config, framework: detected.framework, router: config.router ?? router, styles: styles ?? config.styles };
    await planAliasSetup(changes, detectedConfig);
    await planAppRouterCreate(changes, detectedConfig);
    const globalStyles = await planGlobalStyles(changes, detectedConfig);
    await planStyleableFiles(changes, detectedConfig);
    if (appFiles) await planAppComponent(changes, detectedConfig, appFiles, globalStyles);
    else await planNextRootLayout(changes, detectedConfig, globalStyles);
    if (await decideSkill(changes, options)) await planSkillInstall(changes);
  } catch (error) {
    if (!(error instanceof IssueError)) throw error;
    return { ok: false, dryRun, actions: changes.actions, issues: error.issues };
  }

  if (dryRun) return { ok: true, dryRun, actions: changes.actions, issues: notes };

  await changes.apply();
  const { issues } = await checkStructure(root);
  return { ok: !hasErrors(issues), dryRun, actions: changes.actions, issues: [...notes, ...issues] };
}
