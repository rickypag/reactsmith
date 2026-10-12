import type { NamingStyle } from '../naming.js';
import type { APP_FILES_LOCATIONS, UNKNOWN_FOLDER_POLICIES } from './defaults.js';

export type UnknownFolderPolicy = (typeof UNKNOWN_FOLDER_POLICIES)[number];
export type AppFilesLocation = (typeof APP_FILES_LOCATIONS)[number];

/** A folder map as written by the user: `null` disables a default folder. */
export type FolderMapInput = Record<string, string | null>;

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
}
