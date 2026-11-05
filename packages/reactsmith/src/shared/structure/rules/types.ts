import type { ResolvedConfig } from '../../config/types.js';
import type { Issue } from '../../issues.js';

/** A rule of the check: what it reports for the project at `root`. */
export type Rule = (root: string, config: ResolvedConfig) => Promise<Issue[]>;

/**
 * An example of a rule, shown on the website and run by the rule's tests: a small project and what the rule reports.
 */
export interface RuleExample<Section extends string = string> {
  /** The part of the rule the example belongs to, for grouping examples on the rule's page. */
  section?: Section;
  /** One line saying what the example shows. */
  title: string;
  /** The config file. Left out, the project has an empty one: every default applies. */
  config?: Record<string, unknown>;
  /** The files of the project, by path: a path ending in "/" is an empty folder. */
  tree: Record<string, string>;
  /** What the rule reports, in order. Empty when the project follows the rule. */
  issues: (string | ExampleIssue)[];
}

/** An issue of an example: "severity code path", and its message and hint when given, checked as written. */
export interface ExampleIssue {
  issue: string;
  message?: string;
  hint?: string;
}
