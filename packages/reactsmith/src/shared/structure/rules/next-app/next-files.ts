/** Next's route files: they make a page, a layout or an API route of their folder. */
const ROUTE_FILE = /^(page|layout|template|loading|error|global-error|not-found|global-not-found|forbidden|unauthorized|default|route)\.(tsx|ts|jsx|js)$/;

/** Next's metadata files: the icons, social images, sitemap, robots and manifest of a route. Icons and images may be numbered. */
const METADATA_FILE = new RegExp(
  [
    /^favicon\.ico$/,
    /^icon\d*\.(ico|jpe?g|png|svg|tsx|ts|jsx|js)$/,
    /^apple-icon\d*\.(jpe?g|png|tsx|ts|jsx|js)$/,
    /^(opengraph|twitter)-image\d*\.(jpe?g|png|gif|tsx|ts|jsx|js|alt\.txt)$/,
    /^sitemap\.(xml|ts|js)$/,
    /^robots\.(txt|ts|js)$/,
    /^manifest\.(json|webmanifest|ts|js)$/,
  ]
    .map((pattern) => pattern.source)
    .join('|'),
);

/** Styles the pages and layouts import: the starter's globals.css, or a page's CSS module. */
const STYLE_FILE = /\.css$/;

/** Whether Next's app folder may hold the file: a route file, a metadata file or a stylesheet. */
export function isNextFile(fileName: string): boolean {
  return ROUTE_FILE.test(fileName) || METADATA_FILE.test(fileName) || STYLE_FILE.test(fileName);
}

/** A private folder ("_components"): Next doesn't route it, so it holds code that belongs elsewhere. */
export function isPrivateFolder(name: string): boolean {
  return name.startsWith('_');
}
