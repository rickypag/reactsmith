import type { Issue } from '../../../issues.js';
import { componentFileProblems } from '../../component-file.js';
import type { UnitFile } from '../unit-files.js';

const VIEW_FILE_HINT =
  'A view file holds only the view (an arrow function typed React.FC) and, if needed, its props interface. ' +
  "Move other code to the feature's hooks/, utils/ or types/ folders, and child components to components/.";

/** The view file holds only the view and, if needed, its props interface. */
export function fileContentIssues(files: UnitFile[]): Issue[] {
  return files.flatMap((file) =>
    componentFileProblems(file.text, `${file.component}.tsx`, file.component).map((problem): Issue => ({
      severity: 'error',
      code: 'view-file-content',
      path: file.fileRel,
      message: problem,
      hint: VIEW_FILE_HINT,
    })),
  );
}
