import type { Issue } from '../core/result.js';

export { hasErrors, type Issue, type Severity } from '../core/result.js';

/** Thrown by scripts when they cannot continue. Commands catch it and return the issues. */
export class IssueError extends Error {
  readonly issues: Issue[];

  constructor(issues: Issue | Issue[]) {
    const list = Array.isArray(issues) ? issues : [issues];
    super(list.map((issue) => issue.message).join('\n'));
    this.name = 'IssueError';
    this.issues = list;
  }
}
