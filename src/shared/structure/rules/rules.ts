import { checkAlias } from './alias/alias.js';
import { checkApi } from './api/api.js';
import { checkAppFiles } from './app-files/app-files.js';
import { checkCodeFolders } from './code-folders/code-folders.js';
import { checkComponents } from './components/components.js';
import { checkConstants } from './constants/constants.js';
import { checkFeatures } from './features/features.js';
import { checkFilePlacement } from './file-placement/file-placement.js';
import { checkFolderStructure } from './folder-structure/folder-structure.js';
import { checkIcons } from './icons/icons.js';
import { checkImports } from './imports/imports.js';
import { checkLayouts } from './layouts/layouts.js';
import { checkMarkup } from './markup/markup.js';
import { checkMessages } from './messages/messages.js';
import { checkNextApp } from './next-app/next-app.js';
import { checkRouting } from './routing/routing.js';
import { checkStyles } from './styles/styles.js';
import { checkTokens } from './tokens/tokens.js';
import { checkTyping } from './typing/typing.js';
import type { Rule } from './types.js';
import { checkUnusedCode } from './unused/unused.js';
import { checkViews } from './views/views.js';

/** A rule of the check, by the name of its folder (and of its page on the website). */
export interface NamedRule {
  name: string;
  check: Rule;
}

/**
 * Every rule, in the order the check runs them and reports their issues: the folders and files first, then each
 * kind of thing the project is made of (owner rules), then what applies to any code (cross-cutting rules).
 * folder-structure comes first: without srcDir, it is the only one that runs.
 */
export const RULES: readonly NamedRule[] = [
  { name: 'folder-structure', check: checkFolderStructure },
  { name: 'app-files', check: checkAppFiles },
  { name: 'file-placement', check: checkFilePlacement },
  { name: 'next-app', check: checkNextApp },
  { name: 'routing', check: checkRouting },
  { name: 'views', check: checkViews },
  { name: 'components', check: checkComponents },
  { name: 'layouts', check: checkLayouts },
  { name: 'api', check: checkApi },
  { name: 'code-folders', check: checkCodeFolders },
  { name: 'constants', check: checkConstants },
  { name: 'features', check: checkFeatures },
  { name: 'imports', check: checkImports },
  { name: 'typing', check: checkTyping },
  { name: 'markup', check: checkMarkup },
  { name: 'messages', check: checkMessages },
  { name: 'styles', check: checkStyles },
  { name: 'unused', check: checkUnusedCode },
  { name: 'icons', check: checkIcons },
  { name: 'tokens', check: checkTokens },
  { name: 'alias', check: checkAlias },
];
