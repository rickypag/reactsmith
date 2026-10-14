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
  views: 'views',
};

export const REQUIRED_FEATURE_FOLDERS = ['components'] as const;

export const UNKNOWN_FOLDER_POLICIES = ['error', 'warn', 'allow'] as const;

export const DEFAULT_ALIAS = '@';

/** Where App.tsx / App.css live: in the app folder, or at the root of srcDir. */
export const APP_FILES_LOCATIONS = ['app', 'root'] as const;

/** Folders allowed inside the app folder, which holds the app shell (layout, router). */
export const DEFAULT_APP_FOLDERS: Readonly<Record<string, string>> = {
  components: 'components',
  views: 'views',
};

/** Views are named after their page with this suffix: "UserProfileView". */
export const DEFAULT_VIEW_SUFFIX = 'View';

/** The file in the app folder that defines the app's routes, checked when a router is configured. */
export const DEFAULT_APP_ROUTER = 'router.tsx';

/** A feature's public API: the only file code outside the feature may import from. */
export const DEFAULT_FEATURE_PUBLIC_API = 'index.ts';

/** The file in which a feature exports its route definitions. */
export const DEFAULT_FEATURE_ROUTES = 'routes.tsx';

export const ROUTER_LIBRARIES = ['react-router'] as const;

/** Supported React Router major versions. */
export const REACT_ROUTER_VERSIONS = [7] as const;

/** Supported router modes. Declarative mode comes next. */
export const ROUTER_MODES = ['data'] as const;

export const DEFAULT_IMPORT_RULES = {
  /** Code outside a feature may only import its public API ("@/features/auth"). */
  featurePublicApiOnly: true,
  /** Features may import from the app folder. */
  featuresImportApp: false,
  /** Shared folders (components, hooks, lib...) may import from features. */
  sharedImportFeatures: false,
  /** Shared folders may import from the app folder. */
  sharedImportApp: false,
} as const;
