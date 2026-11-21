import { describe, expect, it } from 'vitest';
import type { CommandResult } from '../../src/core/result.js';
import { renderResult } from '../../src/hosts/cli/render.js';

function render(result: CommandResult, json = false) {
  const out: string[] = [];
  const code = renderResult({ log: (text) => out.push(text), error: () => {} }, result, json);
  return { code, out: out.join('\n') };
}

describe('renderResult', () => {
  it('prints actions, issues and the summary', () => {
    const { code, out } = render({
      ok: false,
      actions: [{ type: 'create', path: 'a.json', message: 'with x' }],
      issues: [{ severity: 'error', code: 'bad', message: 'Broken.', path: 'src', hint: 'Fix it.' }],
    });
    expect(code).toBe(1);
    expect(out).toContain('+ create  a.json  with x');
    expect(out).toContain('✖ error   Broken. (bad)');
    expect(out).toContain('→ Fix it.');
    expect(out).toContain('✖ 1 error, 0 warnings.');
  });

  it('uses the summary when there are no issues', () => {
    expect(render({ ok: true, issues: [], summary: 'All good.' })).toEqual({ code: 0, out: '✔ All good.' });
  });

  it('marks dry runs and skips the summary', () => {
    const { out } = render({ ok: true, dryRun: true, actions: [{ type: 'skip', path: 'x', message: 'done' }] });
    expect(out).toContain('Dry run: nothing was written.');
    expect(out).not.toContain('✔');
  });

  it('prints the whole result as JSON', () => {
    const result: CommandResult = { ok: true, issues: [], data: { configFound: true } };
    expect(JSON.parse(render(result, true).out)).toEqual(result);
  });
});
