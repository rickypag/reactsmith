import { describe, expect, it } from 'vitest';
import { elementInsertCommand } from '../../src/commands/element/insert/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const file = 'src/app/components/TopBar/TopBar.tsx';
const topBar = (jsx: string) => ({
  [file]: `import styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => {\n  return (\n    <header className={styles.root}>\n      ${jsx}\n    </header>\n  );\n};\n`,
  'src/app/components/TopBar/TopBar.module.css': '.root {\n}\n',
  'src/app/components/TopBar/index.ts': "export { TopBar } from './TopBar';\n",
});

async function inlineIssues(jsx: string, config: object = {}) {
  const root = await createProject(topBar(jsx), { appFiles: 'app', ...config });
  return (await checkStructure(root)).issues.filter((issue) => issue.code.startsWith('inline-style-')).map((issue) => `${issue.code}: ${issue.message}`);
}

describe('check: inline styling limit', () => {
  it('allows up to 3 inline style properties and 3 plain classes per element', async () => {
    expect(await inlineIssues('<span style={{ marginTop: 8, opacity: 0.5, color: "red" }} className="sr-only mt-2 px-1">Hi</span>')).toEqual([]);
    expect(await inlineIssues('<span className={styles.brand} style={{ width: size }}>Hi</span>')).toEqual([]);
    expect(await inlineIssues('<span className={`${styles.brand} mt-2`}>Hi</span>')).toEqual([]);
  });

  it('reports more, for style and className alike', async () => {
    expect(await inlineIssues('<span style={{ a: 1, b: 2, c: 3, d: 4 }}>Hi</span>')).toEqual(['inline-style-limit: <span> (line 6) has 4 inline style properties, more than the 3 allowed.']);
    expect(await inlineIssues('<span className="flex items-center gap-2 px-4">Hi</span>')).toEqual(['inline-style-limit: <span> (line 6) has 4 inline classes, more than the 3 allowed.']);
    expect(await inlineIssues('<span className={`${styles.brand} a b c d`}>Hi</span>')).toEqual(['inline-style-limit: <span> (line 6) has 4 inline classes, more than the 3 allowed.']);
  });

  it('follows "inlineStyleLimit", where 0 allows no inline styling', async () => {
    expect(await inlineIssues('<span className="sr-only">Hi</span>', { inlineStyleLimit: 0 })).toEqual(['inline-style-limit: <span> (line 6) has 1 inline class, more than the 0 allowed.']);
    expect(await inlineIssues('<span style={{ a: 1, b: 2, c: 3, d: 4, e: 5 }}>Hi</span>', { inlineStyleLimit: 5 })).toEqual([]);
  });

  it('requires the style to be an object written in place, without spreads', async () => {
    expect(await inlineIssues('<span style={base}>Hi</span>')).toEqual(['inline-style-not-literal: <span> (line 6) has a style that is not written in place (style={base}).']);
    expect(await inlineIssues('<span style={{ ...base, color: "red" }}>Hi</span>')).toEqual(['inline-style-not-literal: <span> (line 6) has a style that spreads another object (...base).']);
  });

  it('rejects an invalid limit in the config', async () => {
    const root = await createProject(topBar('<span>Hi</span>'), { appFiles: 'app', inlineStyleLimit: -1 });
    expect((await checkStructure(root)).issues.map((issue) => issue.code)).toContain('config-invalid');
  });
});

describe('commands keep to the limit', () => {
  it('refuses to insert an element that styles too much inline', async () => {
    const root = await createProject(topBar('<nav />'), { appFiles: 'app' });
    const run = (props: string) =>
      elementInsertCommand.run({
        cwd: root,
        args: { name: 'span' },
        options: { around: undefined, through: undefined, if: undefined, fallback: undefined, into: 'app/components/TopBar/TopBar.tsx#header/nav', position: undefined, from: undefined, props, text: 'Hi', name: undefined, direction: undefined, gap: undefined, align: undefined, justify: undefined, padding: undefined, each: undefined, as: undefined, key: undefined, dryRun: false },
      });
    const refused = await run('className="a b c d"');
    expect(refused.issues?.map((issue) => `${issue.code}: ${issue.message}`)).toEqual(['inline-style-limit: <span> would have 4 inline classes, more than the 3 allowed.']);
    expect((await run('style={base}')).issues?.map((issue) => issue.code)).toEqual(['inline-style-not-literal']);
    expect((await run('style={{ marginTop: 8 }}')).issues).toEqual([]);
    expect(await read(root, file)).toContain('<span style={{ marginTop: 8 }}>Hi</span>');
  });
});
