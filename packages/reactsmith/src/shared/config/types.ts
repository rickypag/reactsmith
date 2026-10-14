import type { NamingStyle } from '../naming.js';
import type { APP_FILES_LOCATIONS, ROUTER_LIBRARIES, ROUTER_MODES, UNKNOWN_FOLDER_POLICIES } from './defaults.js';

export type UnknownFolderPolicy = (typeof UNKNOWN_FOLDER_POLICIES)[number];
export type AppFilesLocation = (typeof APP_FILES_LOCATIONS)[number];
export type RouterLibrary = (typeof ROUTER_LIBRARIES)[number];
export type RouterMode = (typeof ROUTER_MODES)[number];

/** A folder map as written by the user: `null` disables a default folder. */
export type FolderMapInput = Record<string, string | null>;

/** Which routing library the project uses, so generators produce matching route files. */
export interface RouterConfig {
  library: RouterLibrary;
  /** Major version, e.g. 7. */
  version: number;
  mode: RouterMode;
}

export interface ImportRules {
  /** Code outside a feature may only import its public API ("@/features/auth"). */
  featurePublicApiOnly: boolean;
  /** Features may import from the app folder. */
  featuresImportApp: boolean;
  /** Shared folders (components, hooks, lib...) may import from features. */
  sharedImportFeatures: boolean;
  /** Shared folders may import from the app folder. */
  sharedImportApp: boolean;
}

/** The shape of reactsmith.config.json. Every field is optional. */
export interface UserConfig {
  $schema?: string;
  srcDir?: string;
  folders?: FolderMapInput;
  featureFolders?: FolderMapInput;
  featureNaming?: NamingStyle;
  unknownFolders?: UnknownFolderPolicy;
  appFiles?: AppFilesLocation;
  /** Import alias for srcDir ("@" means "@/components/Button"). `null` disables it. */
  alias?: string | null;
  /** Set by init when a supported router is installed. */
  router?: RouterConfig;
  appFolders?: FolderMapInput;
  /** Path inside the app folder, e.g. "router.tsx". `null` disables the check. */
  appRouter?: string | null;
  /** Path inside each feature, e.g. "index.ts". `null` means features have no public API file. */
  featurePublicApi?: string | null;
  /** Path inside each feature, e.g. "routes.tsx" or "routes/index.tsx". `null` disables it. */
  featureRoutes?: string | null;
  imports?: Partial<ImportRules>;
  /** Suffix of view names, e.g. "View" for "UserProfileView". "" for none. */
  viewSuffix?: string;
}

/** The config after merging user values over defaults. Disabled folders are removed. */
export interface ResolvedConfig {
  srcDir: string;
  folders: Record<string, string>;
  featureFolders: Record<string, string>;
  featureNaming: NamingStyle;
  unknownFolders: UnknownFolderPolicy;
  /** Undefined until the user (or init) makes the choice. */
  appFiles?: AppFilesLocation;
  /** Undefined when the alias is disabled. */
  alias?: string;
  /** Undefined when no router is configured. */
  router?: RouterConfig;
  appFolders: Record<string, string>;
  /** Undefined when disabled. */
  appRouter?: string;
  /** Undefined when disabled. */
  featurePublicApi?: string;
  /** Undefined when disabled. */
  featureRoutes?: string;
  imports: ImportRules;
  viewSuffix: string;
}
