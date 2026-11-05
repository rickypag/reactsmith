import { expect, it } from 'vitest';
import { loadConfig } from '../src/shared/config/load.js';
import type { Issue } from '../src/shared/issues.js';
import type { Rule, RuleExample } from '../src/shared/structure/rules/types.js';
import { createProject } from './helpers.js';

/** Runs one rule on a temporary project made of `tree`, with `config` as its config file. */
export async function runRule(rule: Rule, tree: Record<string, string>, config: Record<string, unknown> = {}): Promise<Issue[]> {
  const root = await createProject(tree, config);
  const { config: resolved, issues } = await loadConfig(root);
  if (!resolved) throw new Error(`Invalid config: ${issues.map((issue) => issue.message).join(' ')}`);
  return rule(root, resolved);
}

/** "severity code path" for each issue, the shape of RuleExample.issues. */
export function summary(issues: Issue[]): string[] {
  return issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path ?? ''}`.trim());
}

/** The code of an expected issue: "error unknown-folder src/x" → "unknown-folder". */
function codeOf(entry: string | { issue: string }): string {
  return (typeof entry === 'string' ? entry : entry.issue).split(' ')[1]!;
}

/**
 * One test per example: the rule reports exactly the example's issues. With the rule's `codes`, also checks that
 * each code has an example and that the examples use no other code.
 */
export function testExamples(rule: Rule, examples: RuleExample[], codes?: readonly string[]): void {
  if (codes) {
    it('has an example for every code, and no other code', () => {
      const used = new Set(examples.flatMap((example) => example.issues.map(codeOf)));
      expect(codes.filter((code) => !used.has(code))).toEqual([]);
      expect([...used].filter((code) => !codes.includes(code))).toEqual([]);
    });
  }
  for (const example of examples) {
    it(example.title, async () => {
      const issues = await runRule(rule, example.tree, example.config);
      const expected = example.issues.map((entry) => (typeof entry === 'string' ? { issue: entry } : entry));
      expect(summary(issues)).toEqual(expected.map((entry) => entry.issue));
      expected.forEach((entry, index) => {
        if (entry.message !== undefined) expect(issues[index]?.message).toBe(entry.message);
        if (entry.hint !== undefined) expect(issues[index]?.hint).toBe(entry.hint);
      });
    });
  }
}
