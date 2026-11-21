import type { NamingStyle } from '../naming.js';
import type { FolderTree } from '../tree/types.js';
import type { APP_FILES_LOCATIONS, FRAMEWORKS, I18N_LIBRARIES, ICON_LIBRARIES, ROUTER_LIBRARIES, ROUTER_MODES, STYLE_LIBRARIES, UNKNOWN_FOLDER_POLICIES } from './defaults.js';

export type UnknownFolderPolicy = (typeof UNKNOWN_FOLDER_POLICIES)[number];
export type StyleLibrary = (typeof STYLE_LIBRARIES)[number];
export type IconLibrary = (typeof ICON_LIBRARIES)[number];

/** The icon library of the project, set by init when a supported one is installed. */
export interface IconsConfig {
  library: IconLibrary;
}

export type AppFilesLocation = (typeof APP_FILES_LOCATIONS)[number];
export type Framework = (typeof FRAMEWORKS)[number];
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
  /** Set by init from package.json: "next" leaves routing to Next.js. */
  framework?: Framework;
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
  /** Layout components by import source: "html" for plain elements, or a package or alias path. */
  layoutComponents?: Record<string, string[]>;
  /** The only elements that may hold text, by import source like layoutComponents: "html" or a package such as "@mui/material". Added to the defaults. */
  textComponents?: Record<string, string[]>;
  /** Elements people click, which hold text and other elements, by import source: "html" (a, button) or a package (react-router's NavLink). Added to the defaults. */
  interactiveComponents?: Record<string, string[]>;
  /** How components are styled. Set by init when Tailwind is installed. */
  styles?: StyleLibrary;
  /** At most this many inline style properties and plain classes per element; the rest goes in the style file. 0 allows none. */
  inlineStyleLimit?: number;
  /** The types of shared components, by group: { "actions": ["buttons", "links"] }. Each type is a folder of the shared components. */
  componentTypes?: Record<string, string[]>;
  /** The icon library. Set by init when a supported one is installed. */
  icons?: IconsConfig;
  /** The screen sizes the app adapts to: name → media query, e.g. { "mobile": "(max-width: 767px)" }, in cascade order. */
  breakpoints?: Record<string, string>;
  /** Translations, set by init when a supported library is installed. */
  i18n?: I18nConfig;
}

export type I18nLibrary = (typeof I18N_LIBRARIES)[number];

/** How the app is translated: its library, where its message files are, and the language every key must have. */
export interface I18nConfig {
  library: I18nLibrary;
  /** The message files, from the project root, with "{locale}" for the language: "messages/{locale}.json". */
  messages: string;
  /** The main language: every key is in its file. The other languages may lag behind. */
  defaultLocale: string;
}

/** The config after merging user values over defaults. Disabled folders are removed. */
export interface ResolvedConfig {
  /** Undefined until init finds one (or the user sets it). Use isNext() to ask. */
  framework?: Framework;
  srcDir: string;
  folders: Record<string, string>;
  /** The folder structure: places, the folders and files allowed in each, and what each folder holds. */
  tree: FolderTree;
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
  layoutComponents: Record<string, readonly string[]>;
  textComponents: Record<string, readonly string[]>;
  interactiveComponents: Record<string, readonly string[]>;
  styles: StyleLibrary;
  inlineStyleLimit: number;
  componentTypes: Record<string, readonly string[]>;
  /** Undefined when no icon library is configured. */
  icons?: IconsConfig;
  /** The screen sizes, name → media query, in cascade order. */
  breakpoints: Record<string, string>;
  /** Undefined when the app is not translated. */
  i18n?: I18nConfig;
}
