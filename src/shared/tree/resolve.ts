import { I18N_PRESETS, NEXT_APP_FOLDER } from '../config/defaults.js';
import type { ResolvedConfig } from '../config/types.js';
import { folderContent, PLACE_FILES } from './default.js';
import type { FolderTree, TreeFile, TreeFileRole, TreeFolder } from './types.js';

/** The config values the tree is made of. */
export type TreeSource = Pick<
  ResolvedConfig,
  'framework' | 'srcDir' | 'folders' | 'appFolders' | 'featureFolders' | 'appRouter' | 'featurePublicApi' | 'featureRoutes' | 'i18n'
>;

function treeFolders(map: Record<string, string>): TreeFolder[] {
  return Object.entries(map).map(([role, name]) => ({ role, name, holds: folderContent(role) }));
}

function treeFiles(specs: readonly { role: TreeFileRole; requiredWithRouter: boolean }[], paths: Partial<Record<TreeFileRole, string>>): TreeFile[] {
  return specs.flatMap((spec) => {
    const filePath = paths[spec.role];
    return filePath ? [{ ...spec, path: filePath }] : [];
  });
}

/** The folder structure the config describes: the default shape, with the folder and file names of the config. */
export function resolveTree(config: TreeSource): FolderTree {
  const { srcDir, folders } = config;
  const tree: FolderTree = {
    srcDir,
    src: { folders: treeFolders(folders), files: [] },
    features: {
      path: `${srcDir}/${folders.features}`,
      feature: {
        folders: treeFolders(config.featureFolders),
        files: treeFiles(PLACE_FILES.feature, { publicApi: config.featurePublicApi, routes: config.featureRoutes }),
      },
    },
  };
  if (folders.app) {
    tree.app = {
      path: `${srcDir}/${folders.app}`,
      folders: treeFolders(config.appFolders),
      files: treeFiles(PLACE_FILES.app, { router: config.appRouter }),
    };
  }
  if (config.framework === 'next') {
    // Next's app folder sits at the top of srcDir with the others, but holds Next's pages, not ReactSmith's units.
    tree.src.folders.push({ role: 'next', name: NEXT_APP_FOLDER, holds: 'next' });
    tree.next = { path: `${srcDir}/${NEXT_APP_FOLDER}` };
  }
  // The translation library's setup folder (next-intl's src/i18n) is the dev's, like any free folder.
  const i18nFolder = config.i18n && I18N_PRESETS[config.i18n.library].folder;
  if (i18nFolder && !tree.src.folders.some((folder) => folder.name === i18nFolder)) tree.src.folders.push({ role: 'i18n', name: i18nFolder, holds: 'free' });
  return tree;
}
