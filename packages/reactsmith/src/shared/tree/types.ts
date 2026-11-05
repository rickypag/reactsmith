/**
 * What a folder holds: a place of the tree (the app folder, the features), the units of the structure (views,
 * components, layouts, each in its own folder), plain code files, or files the check leaves alone.
 */
export type FolderContent = 'app' | 'features' | 'views' | 'components' | 'layouts' | 'code' | 'free';

/** A folder allowed directly inside a place. */
export interface TreeFolder {
  /** Its role, the key in the config's folder maps: "views". */
  role: string;
  /** Its name on disk: the role, unless the config renames it. */
  name: string;
  holds: FolderContent;
}

export type TreeFileRole = 'router' | 'publicApi' | 'routes';

/** A file that belongs to a place, e.g. the app's router file. */
export interface TreeFile {
  role: TreeFileRole;
  /** Path inside the place: "router.tsx", or "routes/index.tsx", whose folder is then allowed too. */
  path: string;
  /** Whether the file must exist when the project has a router. */
  requiredWithRouter: boolean;
}

/** A level of the tree: the folders and files allowed directly inside it. */
export interface TreePlace {
  folders: TreeFolder[];
  files: TreeFile[];
}

/** The folder structure of a project, with every path relative to the project root. */
export interface FolderTree {
  srcDir: string;
  /** The top of srcDir. Loose files (main.tsx, index.css…) are allowed there. */
  src: TreePlace;
  /** The app folder, holding the app shell. Undefined when the config disables it. */
  app?: TreePlace & { path: string };
  /** The features folder: it holds only feature folders, each one shaped like `feature`. */
  features: { path: string; feature: TreePlace };
}
