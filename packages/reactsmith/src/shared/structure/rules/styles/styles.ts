import type { ResolvedConfig } from '../../../config/types.js';
import type { Issue } from '../../../issues.js';
import { listUnits } from '../../../tree/list-units.js';
import { componentStyleIssues } from '../../component-styles.js';
import { inlineStyleIssues } from '../../inline-styles.js';
import { unitFiles } from '../unit-files.js';

/**
 * Styles: how every component, view and layout file is styled. Inline styles stay within the configured limit and
 * are literal; a component of the project is styled with a class from its parent's style file, only when it is
 * styleable; a styleable component merges the class into its root. Not this rule's: which style files a unit folder
 * may hold (the unit rules) and styles nothing uses (unused).
 */
export async function checkStyles(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const unit of await listUnits(root, config)) {
    for (const { component, fileRel, text } of await unitFiles(root, unit)) {
      issues.push(
        ...inlineStyleIssues(config, fileRel, text),
        ...(await componentStyleIssues(root, config, fileRel, text, unit.kind === 'component' ? component : undefined)),
      );
    }
  }
  return issues;
}
