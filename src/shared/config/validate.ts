import type { Issue } from '../issues.js';
import { resolveTree } from '../tree/resolve.js';
import { NAMING_STYLES, type NamingStyle } from '../naming.js';
import {
  APP_FILES_LOCATIONS,
  CONFIG_FILE,
  DEFAULT_ALIAS,
  DEFAULT_APP_FOLDERS,
  DEFAULT_APP_ROUTER,
  DEFAULT_FEATURE_FOLDERS,
  DEFAULT_FEATURE_PUBLIC_API,
  DEFAULT_FEATURE_ROUTES,
  DEFAULT_FOLDERS,
  DEFAULT_IMPORT_RULES,
  DEFAULT_STYLES,
  DEFAULT_VIEW_SUFFIX,
  DEFAULT_INLINE_STYLE_LIMIT,
  DEFAULT_COMPONENT_TYPES,
  DEFAULT_BREAKPOINTS,
  I18N_LIBRARIES,
  RESERVED_BREAKPOINT_NAMES,
  FRAMEWORK_LINKS,
  FRAMEWORKS,
  HTML_SOURCE,
  NEXT_APP_FOLDER,
  NEXT_SHELL_FOLDER,
  ICON_LIBRARIES,
  LAYOUT_PRESETS,
  TEXT_COMPONENTS,
  INTERACTIVE_COMPONENTS,
  ROUTER_LINKS,
  REACT_ROUTER_VERSIONS,
  REQUIRED_FEATURE_FOLDERS,
  REQUIRED_FOLDERS,
  ROUTER_LIBRARIES,
  ROUTER_MODES,
  STYLE_LIBRARIES,
  UNKNOWN_FOLDER_POLICIES,
} from './defaults.js';
import type { AppFilesLocation, Framework, I18nConfig, IconsConfig, ImportRules, ResolvedConfig, RouterConfig, StyleLibrary, UnknownFolderPolicy } from './types.js';

const KNOWN_KEYS = new Set([
  '$schema',
  'framework',
  'srcDir',
  'folders',
  'featureFolders',
  'featureNaming',
  'unknownFolders',
  'appFiles',
  'alias',
  'router',
  'appFolders',
  'appRouter',
  'featurePublicApi',
  'featureRoutes',
  'imports',
  'viewSuffix',
  'inlineStyleLimit',
  'componentTypes',
  'layoutComponents',
  'textComponents',
  'interactiveComponents',
  'styles',
  'icons',
  'breakpoints',
  'i18n',
]);

/** A language code: "en", "it", "pt-BR", "zh-Hant". */
export const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const ROUTER_KEYS = ['library', 'version', 'mode'];
const CODE_FILE = /\.(ts|tsx|js|jsx)$/;

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

function unknownKeyErrors(object: Record<string, unknown>, allowed: string[], label: string, issues: Issue[]): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      issues.push(configError(`Unknown key "${label}.${key}".`, `Allowed keys: ${formatList(allowed)}.`));
    }
  }
}

/** A file path inside each feature ("index.ts", "routes/index.tsx") or inside the app folder ("router.tsx"). */
function validateFile(
  raw: Record<string, unknown>,
  key: 'featurePublicApi' | 'featureRoutes' | 'appRouter',
  fallback: string,
  issues: Issue[],
): string | undefined {
  const where = key === 'appRouter' ? 'the app folder' : 'the feature';
  const value = raw[key];
  if (value === undefined) return fallback;
  if (value === null) return undefined;
  if (typeof value !== 'string') {
    issues.push(configError(`"${key}" must be a file path inside ${where}, or null to disable it.`));
    return undefined;
  }
  const normalized = value.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const segments = normalized.split('/');
  const validSegments = segments.every(
    (segment) => segment !== '' && segment !== '.' && segment !== '..' && !INVALID_FOLDER_CHARS.test(segment),
  );
  if (!validSegments || !CODE_FILE.test(normalized)) {
    issues.push(
      configError(`"${key}" must be a .ts, .tsx, .js or .jsx file inside ${where}, got "${value}".`, `e.g. "${fallback}".`),
    );
    return undefined;
  }
  return normalized;
}

function validateRouter(raw: Record<string, unknown>, issues: Issue[]): RouterConfig | undefined {
  const value = raw.router;
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push(configError('"router" must be an object with "library", "version" and "mode".'));
    return undefined;
  }
  unknownKeyErrors(value, ROUTER_KEYS, 'router', issues);

  const { library, version, mode } = value;
  let valid = true;
  if (typeof library !== 'string' || !(ROUTER_LIBRARIES as readonly string[]).includes(library)) {
    issues.push(configError(`"router.library" must be one of ${formatList(ROUTER_LIBRARIES)}.`));
    valid = false;
  }
  if (typeof version !== 'number' || !(REACT_ROUTER_VERSIONS as readonly number[]).includes(version)) {
    issues.push(
      configError(`"router.version" must be a supported major version: ${REACT_ROUTER_VERSIONS.join(', ')}.`),
    );
    valid = false;
  }
  if (typeof mode !== 'string' || !(ROUTER_MODES as readonly string[]).includes(mode)) {
    issues.push(
      configError(
        `"router.mode" must be one of ${formatList(ROUTER_MODES)}.`,
        mode === 'declarative' ? 'Declarative mode is not supported yet.' : undefined,
      ),
    );
    valid = false;
  }
  return valid ? (value as unknown as RouterConfig) : undefined;
}

function validateViewSuffix(raw: Record<string, unknown>, issues: Issue[]): string {
  const value = raw.viewSuffix;
  if (value === undefined) return DEFAULT_VIEW_SUFFIX;
  if (typeof value !== 'string' || !/^[A-Za-z0-9]*$/.test(value)) {
    issues.push(configError('"viewSuffix" must contain only letters and digits, e.g. "View" or "Page", or "" for none.'));
    return DEFAULT_VIEW_SUFFIX;
  }
  return value;
}

function validateInlineStyleLimit(raw: Record<string, unknown>, issues: Issue[]): number {
  const value = raw.inlineStyleLimit;
  if (value === undefined) return DEFAULT_INLINE_STYLE_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issues.push(configError('"inlineStyleLimit" must be a whole number, e.g. 3, or 0 to allow no inline styling.'));
    return DEFAULT_INLINE_STYLE_LIMIT;
  }
  return value;
}

function validateComponentTypes(raw: Record<string, unknown>, issues: Issue[]): Record<string, readonly string[]> {
  const value = raw.componentTypes;
  if (value === undefined) return DEFAULT_COMPONENT_TYPES;
  const example = '{ "actions": ["buttons", "links"] }';
  if (!isPlainObject(value)) {
    issues.push(configError(`"componentTypes" must be an object of groups, each a list of types, e.g. ${example}.`));
    return DEFAULT_COMPONENT_TYPES;
  }
  const seen = new Set<string>();
  for (const [group, types] of Object.entries(value)) {
    if (!Array.isArray(types) || types.some((type) => typeof type !== 'string' || !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(type))) {
      issues.push(configError(`"componentTypes.${group}" must be a list of kebab-case folder names, e.g. ["buttons", "empty-states"].`));
      continue;
    }
    for (const type of types as string[]) {
      if (seen.has(type)) issues.push(configError(`The component type "${type}" is listed twice in "componentTypes".`, 'Each type belongs to one group.'));
      seen.add(type);
    }
  }
  return value as Record<string, string[]>;
}

const HTML_TAG = /^[a-z][a-z0-9-]*$/;
const COMPONENT_NAME = /^[A-Z][A-Za-z0-9_]*$/;
const PACKAGE_NAME = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w.-]+)*$/;

/** What an element map is for, in messages: the layout elements or the text elements. */
const ELEMENT_MAPS = {
  layoutComponents: { example: '["div", "section"]', empty: 'lists no layout components, so components could not be placed anywhere', first: 'div' },
  textComponents: { example: '["span", "p"]', empty: 'lists no text components, so no element could hold text', first: 'span' },
  interactiveComponents: { example: '["a", "button"]', empty: 'lists no interactive components, so there could be no links or buttons', first: 'a' },
} as const;

/** A map of import sources to element names, such as "layoutComponents" or "textComponents". */
/**
 * An element map of the config. With `extend`, what the config lists comes on top of the defaults (adding "kbd"
 * to the text elements keeps "span"); otherwise it replaces them, as a layout preset does to choose the default root.
 */
function validateElementMap(
  raw: Record<string, unknown>,
  key: keyof typeof ELEMENT_MAPS,
  fallback: Readonly<Record<string, readonly string[]>>,
  alias: string | undefined,
  issues: Issue[],
  extend = false,
): Record<string, readonly string[]> {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (!isPlainObject(value)) {
    issues.push(configError(`"${key}" must be an object mapping import sources to component names, e.g. { "html": ${ELEMENT_MAPS[key].example} }.`));
    return fallback;
  }

  const resolved: Record<string, readonly string[]> = {};
  for (const [source, names] of Object.entries(value)) {
    const label = `${key}.${source}`;
    const isHtml = source === HTML_SOURCE;
    const isAliasPath = alias !== undefined && source.startsWith(`${alias}/`);
    if (!isHtml && !isAliasPath && !PACKAGE_NAME.test(source)) {
      issues.push(
        configError(
          `"${label}" is not a valid import source.`,
          `Use "${HTML_SOURCE}" for HTML elements, a package such as "@mui/material", or a path${alias ? ` such as "${alias}/components/layout"` : ''}.`,
        ),
      );
      continue;
    }
    if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) {
      issues.push(configError(`"${label}" must be an array of names.`));
      continue;
    }
    const pattern = isHtml ? HTML_TAG : COMPONENT_NAME;
    const invalid = (names as string[]).filter((name) => !pattern.test(name));
    if (invalid.length > 0) {
      issues.push(
        configError(
          `"${label}" has invalid names: ${formatList(invalid)}.`,
          isHtml ? 'HTML elements are lowercase, e.g. "section".' : 'Components are PascalCase, e.g. "Stack".',
        ),
      );
      continue;
    }
    resolved[source] = [...new Set(names as string[])];
  }
  if (extend) for (const [source, names] of Object.entries(fallback)) resolved[source] = [...new Set([...names, ...(resolved[source] ?? [])])];

  if (Object.values(resolved).every((names) => names.length === 0) && !issues.some((issue) => issue.severity === 'error')) {
    issues.push(configError(`"${key}" ${ELEMENT_MAPS[key].empty}.`, `Add at least one, e.g. "${HTML_SOURCE}": ["${ELEMENT_MAPS[key].first}"].`));
  }
  return resolved;
}

function validateIcons(raw: Record<string, unknown>, issues: Issue[]): IconsConfig | undefined {
  const value = raw.icons;
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push(configError('"icons" must be an object such as { "library": "lucide-react" }.'));
    return undefined;
  }
  unknownKeyErrors(value, ['library'], 'icons', issues);
  if (typeof value.library !== 'string' || !(ICON_LIBRARIES as readonly string[]).includes(value.library)) {
    issues.push(configError(`"icons.library" must be one of ${formatList(ICON_LIBRARIES)}.`));
    return undefined;
  }
  return { library: value.library as IconsConfig['library'] };
}

/** Translations: a supported library, the message files with "{locale}" in their name, and the default language. */
function validateI18n(raw: Record<string, unknown>, issues: Issue[]): I18nConfig | undefined {
  const value = raw.i18n;
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    issues.push(configError('"i18n" must be an object such as { "library": "next-intl", "messages": "messages/{locale}.json", "defaultLocale": "en" }.'));
    return undefined;
  }
  unknownKeyErrors(value, ['library', 'messages', 'defaultLocale'], 'i18n', issues);
  const { library, messages, defaultLocale } = value;
  let valid = true;
  if (typeof library !== 'string' || !(I18N_LIBRARIES as string[]).includes(library)) {
    issues.push(configError(`"i18n.library" must be one of ${formatList(I18N_LIBRARIES)}.`));
    valid = false;
  }
  if (typeof messages !== 'string' || !/^[^{}]*\{locale\}\.json$/.test(messages) || messages.startsWith('/') || messages.split('/').includes('..')) {
    issues.push(configError('"i18n.messages" must be the path of the message files from the project root, with {locale} as the file name, e.g. "messages/{locale}.json".'));
    valid = false;
  }
  if (typeof defaultLocale !== 'string' || !LOCALE.test(defaultLocale)) {
    issues.push(configError('"i18n.defaultLocale" must be a language code, e.g. "en" or "pt-BR".'));
    valid = false;
  }
  return valid ? (value as unknown as I18nConfig) : undefined;
}

/** The breakpoints: names (lowercase, not a reserved variant) and media queries in parentheses, in the order given. */
function validateBreakpoints(raw: Record<string, unknown>, issues: Issue[]): Record<string, string> {
  const value = raw.breakpoints;
  if (value === undefined) return { ...DEFAULT_BREAKPOINTS };
  if (!isPlainObject(value)) {
    issues.push(configError('"breakpoints" must be an object of names and media queries, e.g. { "mobile": "(max-width: 767px)" }.'));
    return { ...DEFAULT_BREAKPOINTS };
  }
  const breakpoints: Record<string, string> = {};
  for (const [name, query] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
      issues.push(configError(`"breakpoints.${name}" is not a valid name.`, 'Use lowercase letters, digits and dashes, e.g. "mobile" or "tablet".'));
    } else if ((RESERVED_BREAKPOINT_NAMES as readonly string[]).includes(name)) {
      issues.push(configError(`"breakpoints.${name}" can't be named "${name}": the name is taken by a style variant.`, 'Use another name, e.g. "mobile", "tablet" or "wide".'));
    } else if (typeof query !== 'string' || !/^\(.+\)$/.test(query.trim())) {
      issues.push(configError(`"breakpoints.${name}" must be a media query in parentheses, e.g. "(max-width: 767px)".`));
    } else {
      breakpoints[name] = query.trim();
    }
  }
  return breakpoints;
}

function validateImports(raw: Record<string, unknown>, issues: Issue[]): ImportRules {
  const rules: ImportRules = { ...DEFAULT_IMPORT_RULES };
  const value = raw.imports;
  if (value === undefined) return rules;
  if (!isPlainObject(value)) {
    issues.push(configError('"imports" must be an object of import rules.'));
    return rules;
  }
  const allowed = Object.keys(DEFAULT_IMPORT_RULES) as (keyof ImportRules)[];
  unknownKeyErrors(value, allowed, 'imports', issues);
  for (const key of allowed) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') {
      issues.push(configError(`"imports.${key}" must be true or false.`));
      continue;
    }
    rules[key] = value[key];
  }
  return rules;
}

/**
 * Merges a user folder map over the defaults.
 * Validates folder names, required roles and duplicates.
 */
function resolveFolderMap(
  raw: Record<string, unknown>,
  key: 'folders' | 'featureFolders' | 'appFolders',
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

  const framework = validateEnum<Framework>(raw, 'framework', FRAMEWORKS, issues);
  const srcDir = validateSrcDir(raw, issues);
  // In a Next.js app, "app" is Next's folder: ReactSmith's app folder is the shell.
  const folderDefaults = framework === 'next' ? { ...DEFAULT_FOLDERS, app: NEXT_SHELL_FOLDER } : DEFAULT_FOLDERS;
  const folders = resolveFolderMap(raw, 'folders', folderDefaults, REQUIRED_FOLDERS, issues);
  const featureFolders = resolveFolderMap(raw, 'featureFolders', DEFAULT_FEATURE_FOLDERS, REQUIRED_FEATURE_FOLDERS, issues);
  const featureNaming = validateEnum<NamingStyle>(raw, 'featureNaming', NAMING_STYLES, issues) ?? 'kebab-case';
  const unknownFolders = validateEnum<UnknownFolderPolicy>(raw, 'unknownFolders', UNKNOWN_FOLDER_POLICIES, issues) ?? 'error';
  const appFiles = validateEnum<AppFilesLocation>(raw, 'appFiles', APP_FILES_LOCATIONS, issues);
  const alias = validateAlias(raw, issues);
  const router = validateRouter(raw, issues);
  const appFolders = resolveFolderMap(raw, 'appFolders', DEFAULT_APP_FOLDERS, [], issues);
  const appRouter = validateFile(raw, 'appRouter', DEFAULT_APP_ROUTER, issues);
  const featurePublicApi = validateFile(raw, 'featurePublicApi', DEFAULT_FEATURE_PUBLIC_API, issues);
  const featureRoutes = validateFile(raw, 'featureRoutes', DEFAULT_FEATURE_ROUTES, issues);
  const imports = validateImports(raw, issues);
  const viewSuffix = validateViewSuffix(raw, issues);
  const inlineStyleLimit = validateInlineStyleLimit(raw, issues);
  const componentTypes = validateComponentTypes(raw, issues);
  const layoutComponents = validateElementMap(raw, 'layoutComponents', LAYOUT_PRESETS.html, alias, issues);
  const textComponents = validateElementMap(raw, 'textComponents', TEXT_COMPONENTS, alias, issues, true);
  const links = router ? ROUTER_LINKS[router.library] : undefined;
  const routerLinks: Record<string, readonly string[]> = router && links ? { [router.library]: links } : {};
  const frameworkLinks = framework ? (FRAMEWORK_LINKS[framework] ?? {}) : {};
  const interactiveComponents = validateElementMap(raw, 'interactiveComponents', { ...INTERACTIVE_COMPONENTS, ...routerLinks, ...frameworkLinks }, alias, issues, true);
  const styles = validateEnum<StyleLibrary>(raw, 'styles', STYLE_LIBRARIES, issues) ?? DEFAULT_STYLES;
  const icons = validateIcons(raw, issues);
  const breakpoints = validateBreakpoints(raw, issues);
  const i18n = validateI18n(raw, issues);

  if (framework === 'next' && router) {
    issues.push(
      configError('"router" cannot be set when "framework" is "next": Next.js routes the pages itself.', 'Remove "router" from the config.'),
    );
  }
  if (framework === 'next') {
    for (const [role, name] of Object.entries(folders)) {
      if (name !== NEXT_APP_FOLDER) continue;
      issues.push(
        configError(
          `"folders.${role}" cannot be "${NEXT_APP_FOLDER}" in a Next.js app: ${srcDir}/${NEXT_APP_FOLDER}/ is Next's, for its pages.`,
          role === 'app' ? `Use another name, e.g. "${NEXT_SHELL_FOLDER}" (the default).` : 'Use another name.',
        ),
      );
    }
  }
  if (appFiles === 'app' && !folders.app) {
    issues.push(
      configError('"appFiles" is "app" but "folders.app" is disabled.', 'Enable "folders.app" or set "appFiles" to "root".'),
    );
  }
  if (featurePublicApi && featureRoutes && featurePublicApi.toLowerCase() === featureRoutes.toLowerCase()) {
    issues.push(configError(`"featurePublicApi" and "featureRoutes" cannot be the same file ("${featureRoutes}").`));
  }
  if (imports.featurePublicApiOnly && raw.featurePublicApi === null) {
    issues.push(
      configError(
        '"imports.featurePublicApiOnly" needs a public API file, but "featurePublicApi" is null.',
        'Set "featurePublicApi" (e.g. "index.ts") or set "imports.featurePublicApiOnly" to false.',
      ),
    );
  }

  if (issues.some((issue) => issue.severity === 'error')) return { issues };

  const config: ResolvedConfig = {
    srcDir,
    folders,
    tree: resolveTree({ framework, srcDir, folders, appFolders, featureFolders, appRouter, featurePublicApi, featureRoutes, i18n }),
    featureFolders,
    featureNaming,
    unknownFolders,
    appFolders,
    imports,
    viewSuffix,
    layoutComponents,
    textComponents,
    interactiveComponents,
    styles,
    inlineStyleLimit,
    componentTypes,
    breakpoints,
  };
  if (framework) config.framework = framework;
  if (i18n) config.i18n = i18n;
  if (appFiles) config.appFiles = appFiles;
  if (alias) config.alias = alias;
  if (router) config.router = router;
  if (appRouter) config.appRouter = appRouter;
  if (featurePublicApi) config.featurePublicApi = featurePublicApi;
  if (featureRoutes) config.featureRoutes = featureRoutes;
  if (icons) config.icons = icons;
  return { config, issues };
}
