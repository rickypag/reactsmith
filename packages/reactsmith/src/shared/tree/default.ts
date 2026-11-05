import type { FolderContent, TreeFileRole } from './types.js';

/**
 * What the folder of each role holds. Roles not listed here (assets, config, lib, testing, styles, and the ones a
 * config adds) hold files the check leaves alone.
 */
export const FOLDER_CONTENTS: Readonly<Record<string, FolderContent>> = {
  app: 'app',
  features: 'features',
  views: 'views',
  components: 'components',
  layouts: 'layouts',
  hooks: 'code',
  utils: 'code',
  types: 'code',
  stores: 'code',
};

export function folderContent(role: string): FolderContent {
  return FOLDER_CONTENTS[role] ?? 'free';
}

/** The files of each place. Their paths come from the config: appRouter, featurePublicApi, featureRoutes. */
export const PLACE_FILES = {
  app: [{ role: 'router', requiredWithRouter: true }],
  feature: [
    // A missing public API file is reported with the import scan, which tells whether the feature is used.
    { role: 'publicApi', requiredWithRouter: false },
    { role: 'routes', requiredWithRouter: true },
  ],
} as const satisfies Record<string, readonly { role: TreeFileRole; requiredWithRouter: boolean }[]>;
