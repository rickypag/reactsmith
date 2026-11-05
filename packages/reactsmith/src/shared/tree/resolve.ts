import type { ResolvedConfig } from '../config/types.js';
import { folderContent, PLACE_FILES } from './default.js';
import type { FolderTree, TreeFile, TreeFileRole, TreeFolder } from './types.js';

/** The config values the tree is made of. */
export type TreeSource = Pick<
  ResolvedConfig,
  'srcDir' | 'folders' | 'appFolders' | 'featureFolders' | 'appRouter' | 'featurePublicApi' | 'featureRoutes'
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
  return tree;
}
