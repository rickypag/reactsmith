import type { Issue } from '../issues.js';
import { NAMING_STYLES, type NamingStyle } from '../naming.js';
import {
  APP_FILES_LOCATIONS,
  CONFIG_FILE,
  DEFAULT_ALIAS,
  DEFAULT_FEATURE_FOLDERS,
  DEFAULT_FOLDERS,
  REQUIRED_FEATURE_FOLDERS,
  REQUIRED_FOLDERS,
  UNKNOWN_FOLDER_POLICIES,
} from './defaults.js';
import type { AppFilesLocation, ResolvedConfig, UnknownFolderPolicy } from './types.js';

const KNOWN_KEYS = new Set([
  '$schema',
  'srcDir',
  'folders',
  'featureFolders',
  'featureNaming',
  'unknownFolders',
  'appFiles',
  'alias',
]);

const INVALID_FOLDER_CHARS = /[\\/<>:"|?*]/;

export interface ValidationResult {
  /** Present only when there are no errors. */
  config?: ResolvedConfig;
  issues: Issue[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function configError(message: string, hint?: string): Issue {
  return { severity: 'error', code: 'config-invalid', path: CONFIG_FILE, message, hint };
}

function formatList(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ');
}

function validateEnum<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  issues: Issue[],
): T | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  issues.push(configError(`"${key}" must be one of ${formatList(allowed)}.`));
  return undefined;
}

function validateAlias(raw: Record<string, unknown>, issues: Issue[]): string | undefined {
  const value = raw.alias;
  if (value === undefined) return DEFAULT_ALIAS;
  if (value === null) return undefined;
  if (typeof value !== 'string' || !/^[^\s./\\][^\s/\\]*$/.test(value)) {
    issues.push(configError('"alias" must be an import prefix such as "@" or "~", or null to disable it.'));
    return undefined;
  }
  return value;
}

function validateSrcDir(raw: Record<string, unknown>, issues: Issue[]): string {
  const value = raw.srcDir;
  if (value === undefined) return 'src';
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(configError('"srcDir" must be a non-empty string.'));
    return 'src';
  }
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  const segments = normalized.split('/');
  if (/^([a-zA-Z]:|\/)/.test(normalized) || segments.includes('..') || normalized === '' || normalized === '.') {
    issues.push(configError(`"srcDir" must be a folder inside the project, got "${value}".`, 'Use a relative path such as "src".'));
  }
  return normalized;
}

/**
 * Merges a user folder map over the defaults.
 * Validates folder names, required roles and duplicates.
 */
function resolveFolderMap(
  raw: Record<string, unknown>,
  key: 'folders' | 'featureFolders',
  defaults: Readonly<Record<string, string>>,
  required: readonly string[],
  issues: Issue[],
): Record<string, string> {
  const input = raw[key];
  const merged: Record<string, string | null> = { ...defaults };

  if (input !== undefined && !isPlainObject(input)) {
    issues.push(configError(`"${key}" must be an object mapping roles to folder names.`));
  } else if (input) {
    for (const [role, name] of Object.entries(input)) {
      const label = `${key}.${role}`;
      if (name === null) {
        if (required.includes(role)) {
          issues.push(
            configError(`"${label}" is required and cannot be disabled.`, `Rename it instead, e.g. "${role}": "my-${role}".`),
          );
          continue;
        }
        if (!(role in defaults)) {
          issues.push({
            severity: 'warning',
            code: 'config-unused-key',
            path: CONFIG_FILE,
            message: `"${label}" is null but "${role}" is not a default folder, so there is nothing to disable.`,
            hint: `Remove "${role}" from "${key}".`,
          });
        }
        merged[role] = null;
        continue;
      }
      if (typeof name !== 'string' || name.trim() === '') {
        issues.push(configError(`"${label}" must be a folder name or null.`));
        continue;
      }
      if (name !== name.trim() || INVALID_FOLDER_CHARS.test(name) || name === '.' || name === '..') {
        issues.push(
          configError(`"${label}" has an invalid folder name "${name}".`, 'Use a single folder name without slashes or special characters.'),
        );
        continue;
      }
      merged[role] = name;
    }
  }

  const resolved: Record<string, string> = {};
  const roleByName = new Map<string, string>();
  for (const [role, name] of Object.entries(merged)) {
    if (name === null) continue;
    // Compare case-insensitively: on Windows and macOS "Hooks" and "hooks" are the same folder.
    const existing = roleByName.get(name.toLowerCase());
    if (existing) {
      issues.push(configError(`"${key}.${existing}" and "${key}.${role}" both use the folder name "${name}".`));
      continue;
    }
    roleByName.set(name.toLowerCase(), role);
    resolved[role] = name;
  }
  return resolved;
}

/** Validates raw JSON from reactsmith.config.json and merges it with the defaults. */
export function validateConfig(raw: unknown): ValidationResult {
  const issues: Issue[] = [];

  if (!isPlainObject(raw)) {
    return { issues: [configError('The config must be a JSON object.')] };
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      issues.push(configError(`Unknown key "${key}".`, `Allowed keys: ${formatList([...KNOWN_KEYS])}.`));
    }
  }

  const srcDir = validateSrcDir(raw, issues);
  const folders = resolveFolderMap(raw, 'folders', DEFAULT_FOLDERS, REQUIRED_FOLDERS, issues);
  const featureFolders = resolveFolderMap(raw, 'featureFolders', DEFAULT_FEATURE_FOLDERS, REQUIRED_FEATURE_FOLDERS, issues);
  const featureNaming = validateEnum<NamingStyle>(raw, 'featureNaming', NAMING_STYLES, issues) ?? 'kebab-case';
  const unknownFolders = validateEnum<UnknownFolderPolicy>(raw, 'unknownFolders', UNKNOWN_FOLDER_POLICIES, issues) ?? 'error';
  const appFiles = validateEnum<AppFilesLocation>(raw, 'appFiles', APP_FILES_LOCATIONS, issues);
  const alias = validateAlias(raw, issues);

  if (appFiles === 'app' && !folders.app) {
    issues.push(
      configError('"appFiles" is "app" but "folders.app" is disabled.', 'Enable "folders.app" or set "appFiles" to "root".'),
    );
  }

  if (issues.some((issue) => issue.severity === 'error')) return { issues };

  const config: ResolvedConfig = { srcDir, folders, featureFolders, featureNaming, unknownFolders };
  if (appFiles) config.appFiles = appFiles;
  if (alias) config.alias = alias;
  return { config, issues };
}
