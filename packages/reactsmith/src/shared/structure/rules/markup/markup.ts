import type { ResolvedConfig } from '../../../config/types.js';
import { tableNestingIssues } from '../../../elements/table.js';
import type { Issue } from '../../../issues.js';
import { listUnits } from '../../../tree/list-units.js';
import { plainLinkIssues } from '../../links.js';
import { listShapeIssues } from '../../lists.js';
import { textPlacementIssues } from '../../text.js';
import { unitFiles } from '../unit-files.js';

/**
 * Markup: the JSX of every component, view and layout file. Text sits in a text element, lists and conditions have
 * the shapes the commands can edit, internal links use the router's link, and tables nest the way browsers keep them.
 * Not this rule's: what else a unit's files hold (the unit rules) and how they are styled (styles).
 */
export async function checkMarkup(root: string, config: ResolvedConfig): Promise<Issue[]> {
  const issues: Issue[] = [];
  for (const unit of await listUnits(root, config)) {
    for (const { fileRel, text } of await unitFiles(root, unit)) {
      issues.push(
        ...textPlacementIssues(root, config, fileRel, text),
        ...listShapeIssues(fileRel, text),
        ...plainLinkIssues(config, fileRel, text),
        ...tableNestingIssues(fileRel, text),
      );
    }
  }
  return issues;
}
