import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { IssueError, type Issue } from '../issues.js';
import { CONFIG_FILE } from './defaults.js';
import type { ResolvedConfig } from './types.js';
import { validateConfig } from './validate.js';

export interface LoadResult {
  /** Absolute path of the config file, whether or not it exists. */
  configPath: string;
  found: boolean;
  /** Present only when the config is valid. Falls back to defaults when the file is missing. */
  config?: ResolvedConfig;
  issues: Issue[];
}

export async function loadConfig(root: string): Promise<LoadResult> {
  const configPath = path.join(root, CONFIG_FILE);

  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { config, issues } = validateConfig({});
    issues.unshift({
      severity: 'warning',
      code: 'config-missing',
      path: CONFIG_FILE,
      message: `No ${CONFIG_FILE} found, using the default structure.`,
      hint: `Create ${CONFIG_FILE} in the project root to customize it.`,
    });
    return { configPath, found: false, config, issues };
  }

  let raw: unknown;
  try {
    // Strip a UTF-8 BOM, which some Windows editors add.
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    return {
      configPath,
      found: true,
      issues: [
        {
          severity: 'error',
          code: 'config-invalid-json',
          path: CONFIG_FILE,
          message: `${CONFIG_FILE} is not valid JSON: ${(error as Error).message}`,
        },
      ],
    };
  }

  return { configPath, found: true, ...validateConfig(raw) };
}

/** Loads the config, or throws an IssueError when it is invalid. A missing file gives the defaults. */
export async function requireConfig(root: string): Promise<ResolvedConfig> {
  const { config, issues } = await loadConfig(root);
  if (!config) throw new IssueError(issues);
  return config;
}
