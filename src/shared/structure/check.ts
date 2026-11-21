import path from 'node:path';
import { loadConfig } from '../config/load.js';
import { exists } from '../files.js';
import type { Issue } from '../issues.js';
import { isInLib } from './lib.js';
import { RULES } from './rules/rules.js';

export interface CheckResult {
  root: string;
  configFound: boolean;
  issues: Issue[];
}

/**
 * Validates the project at `root` against its config, rule by rule. Never modifies files. The lib folder is not
 * checked: it holds plain code outside the UI, which ReactSmith doesn't manage.
 */
export async function checkStructure(root: string): Promise<CheckResult> {
  const { found, config, issues } = await loadConfig(root);
  if (!config) return { root, configFound: found, issues };

  const [first, ...rest] = RULES;
  issues.push(...(await first!.check(root, config)));
  // Without srcDir, there is nothing else to check: folder-structure has said so.
  if (await exists(path.join(root, config.srcDir))) {
    for (const rule of rest) issues.push(...(await rule.check(root, config)));
  }
  return { root, configFound: found, issues: issues.filter((issue) => !issue.path || !isInLib(config, issue.path)) };
}
