export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** Stable identifier, safe for tools and agents to match on. */
  code: string;
  message: string;
  /** Project-relative path (forward slashes) the issue refers to. */
  path?: string;
  /** What to do to resolve the issue. */
  hint?: string;
}

export type ChangeType = 'create' | 'update' | 'move' | 'skip';

/** One change made (or planned) by a command. */
export interface ChangeAction {
  type: ChangeType;
  /** Project-relative path. */
  path: string;
  message: string;
}

/** What every command returns. Hosts decide how to show it: text, JSON, a UI... */
export interface CommandResult {
  ok: boolean;
  /** True when the changes were only planned, not written. */
  dryRun?: boolean;
  actions?: ChangeAction[];
  issues?: Issue[];
  /** Short message for people, e.g. "Project structure is valid." */
  summary?: string;
  /** Command-specific data for tools and agents. */
  data?: Record<string, unknown>;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
