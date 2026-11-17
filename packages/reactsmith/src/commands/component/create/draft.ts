import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandResult } from '../../../core/result.js';
import { ChangeSet, FileJournal, setJournal, type ChangeAction } from '../../../shared/changes.js';
import { planComponentCreate } from '../../../shared/components/create.js';
import { planReplaceCleanup, planReturnReplace, returnedRange, type ReplaceTarget } from '../../../shared/components/draft/replace.js';
import type { DraftChild, DraftElement, DraftLayout, DraftProblem } from '../../../shared/components/draft/parse.js';
import type { ComponentOwner } from '../../../shared/components/scope.js';
import type { ResolvedConfig } from '../../../shared/config/types.js';
import { describeFile, outlineElements } from '../../../shared/elements/describe.js';
import { planElementInsert } from '../../../shared/elements/insert.js';
import { planElementUpdate } from '../../../shared/elements/update.js';
import { IssueError, type Issue } from '../../../shared/issues.js';
import { checkStructure } from '../../../shared/structure/check.js';
import { parseCss, type StyleState } from '../../../shared/styles/declarations.js';
import { parseGap, parsePadding, type FlexLayout, type RootStyle } from '../../../shared/styles/layout.js';
import { planStyleUpdate } from '../../../shared/styles/update.js';
import { deferTypeChecks, takeDeferredTypeChecks, typeErrorsIn } from '../../../shared/types/check.js';

/** Issues of the new component that check reports but that don't block it: a new child is unused until its parent exists. */
const ALLOWED_CHECK_CODES = new Set(['component-unused']);

/** A step that refused: its issues, said at the line of the draft it came from. */
class StepRefused extends Error {
  constructor(readonly issues: Issue[]) {
    super('A step of the draft was refused.');
  }
}

export function draftProblemIssues(problems: DraftProblem[]): Issue[] {
  return problems.map((problem) => ({ severity: 'error', code: problem.code, path: `draft:${problem.line}`, message: `Line ${problem.line}: ${problem.message}`, hint: problem.hint }));
}

/** Reads the draft: from stdin for "-", else from a file of the project. */
export async function readDraft(cwd: string, source: string, readStdin: (() => Promise<string>) | undefined): Promise<string> {
  if (source === '-') {
    if (!readStdin) throw new IssueError({ severity: 'error', code: 'draft-stdin-unavailable', message: 'There is no input to read the draft from.', hint: 'Pass the draft as a file: --jsx draft.tsx.' });
    return readStdin();
  }
  try {
    return await readFile(path.resolve(cwd, source), 'utf8');
  } catch {
    throw new IssueError({ severity: 'error', code: 'draft-file-missing', path: source, message: `Cannot read "${source}".`, hint: 'Check the path, relative to the project root, or pass --jsx - to read the draft from stdin.' });
  }
}

interface DraftRunOptions {
  cwd: string;
  config: ResolvedConfig;
  owner: ComponentOwner;
  name: string;
  interface?: string;
  root: DraftElement;
  /** The component file, project-relative: "src/features/catalog/components/ProductCard/ProductCard.tsx". */
  fileRel: string;
  /** The same file from the source folder, as ids start: "features/catalog/components/ProductCard/ProductCard.tsx". */
  srcRel: string;
  dryRun: boolean;
  /** With --replace: the component whose JSX the draft replaces, instead of a new one. */
  replace?: ReplaceTarget;
}

/** An issue as check reports it, to tell the ones a replace adds from those the folder already had. */
const issueKey = (issue: Issue) => `${issue.code}\0${issue.path}\0${issue.message}`;

/** The layout options of a draft element, read as the commands read them; undefined when it has none. */
function layoutOf(layout: DraftLayout): RootStyle | undefined {
  const style: RootStyle = {};
  if (layout.direction !== undefined) style.direction = layout.direction as RootStyle['direction'];
  if (layout.gap !== undefined) style.gap = parseGap(layout.gap);
  if (layout.align !== undefined) style.align = layout.align as RootStyle['align'];
  if (layout.justify !== undefined) style.justify = layout.justify as RootStyle['justify'];
  if (layout.padding !== undefined) style.padding = parsePadding(layout.padding);
  return Object.keys(style).length ? style : undefined;
}

/**
 * Builds a component from its draft: creates it with its root, then inserts and styles each element, in the order of
 * the draft, with the planners the element commands use. The files are written as it goes, so each step builds on the
 * ones before; a refusal, a type error or a check error puts every file back as it was. Type checks wait until the end.
 */
export async function runDraft(options: DraftRunOptions): Promise<CommandResult> {
  const { cwd, config, root, fileRel, srcRel } = options;
  const actions = new Map<string, ChangeAction>();
  const warnings: Issue[] = [];
  const journal = new FileJournal(cwd);

  // REACTSMITH_TIMING=1 prints how long each part took, on stderr.
  const started = Date.now();
  const time = (label: string) => {
    if (process.env.REACTSMITH_TIMING) process.stderr.write(`${label}: ${Date.now() - started}ms\n`);
  };

  /** Plans one step and writes it, so the next step reads it; a refusal names the draft's line. */
  const step = async <T>(label: string, line: number, plan: (changes: ChangeSet) => Promise<T>): Promise<T> => {
    const changes = new ChangeSet(cwd);
    let result: T;
    try {
      result = await plan(changes);
    } catch (error) {
      if (!(error instanceof IssueError)) throw error;
      throw new StepRefused(error.issues.map((issue) => ({ ...issue, message: `Line ${line}: ${issue.message}`, path: issue.path ?? `draft:${line}` })));
    }
    await changes.apply();
    for (const action of changes.actions) if (!actions.has(action.path)) actions.set(action.path, action);
    time(`  ${label} (line ${line})`);
    return result;
  };
  const warn = (line: number, issues: Issue[] | undefined) => warnings.push(...(issues ?? []).map((issue) => ({ ...issue, message: `Line ${line}: ${issue.message}` })));

  const style = async (element: DraftElement, id: string) => {
    for (const update of element.styles) {
      await step('style update', update.line, (changes) =>
        planStyleUpdate(changes, config, {
          target: id,
          input: update.css === undefined ? undefined : parseCss(update.css),
          classes: update.classes,
          state: update.state as StyleState | undefined,
          at: update.at,
          when: update.when,
        }),
      );
    }
  };

  const fill = async (element: DraftElement, id: string) => {
    await style(element, id);
    // The children written before the text go first, last one first, so they keep the draft's order.
    for (const child of [...element.before].reverse()) await insert(child, id, 'first');
    for (const child of element.children) await insert(child, id, 'inside');
  };

  const insert = async (child: DraftChild, parentId: string, position: 'inside' | 'first'): Promise<void> => {
    if (child.kind === 'ternary') {
      await insert({ ...child.whenTrue, if: child.test }, parentId, position);
      await insert(child.whenFalse, `${parentId}/{?${child.test}}`, 'inside');
      return;
    }
    const inserted = await step('element insert', child.line, (changes) =>
      planElementInsert(changes, config, {
        tag: child.tag,
        target: parentId,
        position,
        from: child.from,
        props: child.props,
        text: child.text,
        message: child.message,
        name: child.name,
        style: layoutOf(child.layout),
        list: child.list,
        if: child.if,
        fallback: child.fallback,
      }),
    );
    warn(child.line, inserted.warnings);
    await fill(child, inserted.id);
  };

  const { replace } = options;
  // A replace only answers for the issues it adds: those the component's folder already had are not its own.
  const before = replace ? new Set((await checkStructure(cwd)).issues.map(issueKey)) : new Set<string>();
  if (replace) time('check before');

  setJournal(journal);
  deferTypeChecks();
  let issues: Issue[];
  try {
    const rootId = `${srcRel}#root`;
    let oldNames: string[] = [];
    if (replace) {
      oldNames = await step('component replace', root.line, (changes) => planReturnReplace(changes, config, replace, root, layoutOf(root.layout)));
      if (root.props !== undefined || root.text !== undefined || root.message !== undefined) {
        const updated = await step('element update', root.line, (changes) => planElementUpdate(changes, config, { target: rootId, props: root.props, text: root.text, message: root.message }));
        warn(root.line, updated.warnings);
      }
    } else {
      if (root.rendersChildren && !/(^|;)\s*children\??\s*:/.test(options.interface ?? '')) {
        throw new StepRefused([
          {
            severity: 'error',
            code: 'draft-children-undeclared',
            path: `draft:${root.line}`,
            message: `Line ${root.line}: the root renders {children}, but ${options.name} has no children prop.`,
            hint: 'Declare it: --interface "children: React.ReactNode".',
          },
        ]);
      }
      const created = await step('component create', root.line, (changes) =>
        planComponentCreate(changes, config, {
          owner: options.owner,
          name: options.name,
          interface: options.interface,
          root: root.tag,
          from: root.from,
          props: root.props,
          text: root.text,
          layout: layoutOf(root.layout) as FlexLayout | undefined,
        }),
      );
      warn(root.line, created);
      if (root.message !== undefined) {
        const updated = await step('element update', root.line, (changes) => planElementUpdate(changes, config, { target: rootId, message: root.message }));
        warn(root.line, updated.warnings);
      }
    }
    await fill(root, rootId);
    if (replace) await step('cleanup', root.line, (changes) => planReplaceCleanup(changes, replace, oldNames));
    time('steps');
    issues = (await finalChecks(cwd, fileRel, options.name, time)).filter((issue) => !before.has(issueKey(issue)));
  } catch (error) {
    setJournal(undefined);
    takeDeferredTypeChecks();
    if (!(error instanceof StepRefused) && !(error instanceof IssueError)) {
      await journal.restore();
      throw error;
    }
    issues = error.issues;
  } finally {
    setJournal(undefined);
    takeDeferredTypeChecks();
  }

  if (issues.some((issue) => issue.severity === 'error')) {
    await journal.restore();
    return { ok: false, actions: [], issues: [...issues, ...warnings], summary: 'Nothing was written: fix the draft and run the command again.' };
  }
  const description = await describeFile(cwd, config, fileRel);
  if (options.dryRun) await journal.restore();
  return {
    ok: true,
    dryRun: options.dryRun,
    actions: [...actions.values()],
    issues: [...warnings, ...issues],
    summary: [`${options.dryRun ? (replace ? 'Would replace' : 'Would create') : replace ? 'Replaced the JSX of' : 'Created'} ${fileRel}:`, ...outlineElements(description.roots)].join('\n'),
    data: { file: fileRel, elements: description.roots },
  };
}

/** The type check put off by the steps, then check, on the new component's folder only. Returns its issues. */
async function finalChecks(cwd: string, fileRel: string, name: string, time: (label: string) => void): Promise<Issue[]> {
  const issues: Issue[] = [];
  if (takeDeferredTypeChecks().includes(fileRel)) {
    const text = await readFile(path.join(cwd, fileRel), 'utf8');
    // Only the JSX is the draft's: errors in the code written by hand before it are not.
    const [start, end] = returnedRange(text, fileRel, name) ?? [0, text.length];
    for (const error of typeErrorsIn(cwd, fileRel, text, start, end) ?? []) {
      const lineStart = text.lastIndexOf('\n', error.start) + 1;
      const lineEnd = text.indexOf('\n', error.start);
      const code = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim();
      issues.push({
        severity: 'error',
        code: 'element-props-invalid',
        path: fileRel,
        message: `The component would not compile, at ${code}: ${error.message}`,
        hint: 'Check the props of that element in the draft: its TypeScript types say which ones it takes.',
      });
    }
    time('type check');
    if (issues.length) return issues;
  }
  const folder = `${path.posix.dirname(fileRel)}/`;
  const checked = await checkStructure(cwd);
  time('check');
  issues.push(...checked.issues.filter((issue) => issue.path?.startsWith(folder) && !ALLOWED_CHECK_CODES.has(issue.code)));
  return issues;
}
