/** The tool name. The package name and bin in package.json must match it. */
export const TOOL_NAME = 'reactsmith';

export const CONFIG_FILE = `${TOOL_NAME}.config.json`;

/** Top-level folders inside srcDir. Keys are roles, values are folder names on disk. */
export const DEFAULT_FOLDERS: Readonly<Record<string, string>> = {
  app: 'app',
  assets: 'assets',
  components: 'components',
  config: 'config',
  features: 'features',
  hooks: 'hooks',
  lib: 'lib',
  stores: 'stores',
  testing: 'testing',
  types: 'types',
  utils: 'utils',
};

/** Folders the component flows depend on: they can be renamed but not disabled. */
export const REQUIRED_FOLDERS = ['components', 'features'] as const;

/** Folders allowed inside each feature. */
export const DEFAULT_FEATURE_FOLDERS: Readonly<Record<string, string>> = {
  api: 'api',
  assets: 'assets',
  components: 'components',
  hooks: 'hooks',
  stores: 'stores',
  types: 'types',
  utils: 'utils',
};

export const REQUIRED_FEATURE_FOLDERS = ['components'] as const;

export const UNKNOWN_FOLDER_POLICIES = ['error', 'warn', 'allow'] as const;

export const DEFAULT_ALIAS = '@';

/** Where App.tsx / App.css live: in the app folder, or at the root of srcDir. */
export const APP_FILES_LOCATIONS = ['app', 'root'] as const;
