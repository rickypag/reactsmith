import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/commands/index.js';
import type { CommandIO } from '../../src/hosts/cli/io.js';
import { runCli } from '../../src/hosts/cli/main.js';
import { splitBatch } from '../../src/hosts/cli/words.js';
import { createProject, exists, read } from '../helpers.js';

const dir = 'src/app/components/TopBar';
const file = `${dir}/TopBar.tsx`;

const project = () =>
  createProject(
    {
      [file]: "import styles from './TopBar.module.css';\n\nexport const TopBar: React.FC = () => {\n  return <header className={styles.root} />;\n};\n",
      [`${dir}/TopBar.module.css`]: '.root {\n}\n',
      [`${dir}/index.ts`]: "export { TopBar } from './TopBar';\n",
    },
    { appFiles: 'app' },
  );

async function batch(root: string, input: string, json = false) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIO = { log: (text) => out.push(text), error: (text) => err.push(text) };
  const code = await runCli({ argv: ['batch', '--cwd', root, ...(json ? ['--json'] : [])], commands: COMMANDS, createIO: () => io, readStdin: async () => input });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('splitBatch', () => {
  it('reads words as a shell does: quotes, escapes, continued lines, comments and variables', () => {
    const lines = splitBatch(
      [
        '# a comment',
        'T=src/app/components/TopBar/TopBar.tsx',
        `element insert span --into "$T#header" --text 'It''s "{x}"' # trailing`,
        'style update "${T}#header" \\',
        '  --css "content: \\"\\$\\""',
        '',
      ].join('\r\n'),
    );
    expect(lines.map((line) => [line.line, line.words])).toEqual([
      [3, ['element', 'insert', 'span', '--into', 'src/app/components/TopBar/TopBar.tsx#header', '--text', 'Its "{x}"']],
      [4, ['style', 'update', 'src/app/components/TopBar/TopBar.tsx#header', '--css', 'content: "$"']],
    ]);
  });

  it('refuses a variable not set and a quote not closed, with the line', () => {
    expect(() => splitBatch('check\nelement remove "$X#a"')).toThrow('"$X" is not set');
    expect(() => splitBatch('check\ncheck "open')).toThrow('quote is not closed');
  });
});

describe('batch', () => {
  it('runs the lines in order, each on the files the ones before left', async () => {
    const root = await project();
    const { code, out } = await batch(
      root,
      ['T=app/components/TopBar/TopBar.tsx', 'npx reactsmith element insert nav --into "$T#header" --name links', 'reactsmith element insert a --into "$T#links" --props "href=\'/\'" --text Home'].join('\n'),
    );
    expect(code).toBe(0);
    expect(out).toContain('2 commands ran.');
    expect(await read(root, file)).toContain("<nav className={styles.links}>\n        <a href='/'>Home</a>\n      </nav>");
  });

  it('stops at the first refusal, saying which lines did not run', async () => {
    const root = await project();
    const { code, out } = await batch(
      root,
      [
        'element insert nav --into "app/components/TopBar/TopBar.tsx#header" --name links',
        'element insert a --into "app/components/TopBar/TopBar.tsx#nowhere" --text Home',
        'element insert span --into "app/components/TopBar/TopBar.tsx#header" --text Never',
      ].join('\n'),
      true,
    );
    expect(code).toBe(1);
    const result = JSON.parse(out);
    expect(result).toMatchObject({ ok: false, ran: 2, stoppedAt: 2, notRun: [3] });
    expect(result.results[1].result.issues[0].code).toBe('element-not-found');
    expect(await read(root, file)).toContain('<nav className={styles.links} />');
    expect(await read(root, file)).not.toContain('Never');
  });

  it('runs nothing when a line is not valid, listing every such line', async () => {
    const root = await project();
    const before = await read(root, file);
    const { code, err } = await batch(root, ['element insert nav --into "app/components/TopBar/TopBar.tsx#header"', 'element insert span --bogus', 'feature nope', 'check --dry-run'].join('\n'));
    expect(code).toBe(2);
    expect(err).toContain('line 2: Unknown option "--bogus" for "element insert".');
    expect(err).toContain('line 3: "feature nope" is not a command.');
    expect(err).toContain('line 4: --dry-run applies to the whole batch');
    expect(await read(root, file)).toBe(before);
  });

  it('checks the whole plan with --dry-run: every refusal, each line on the ones before, nothing changed', async () => {
    const root = await project();
    const before = await read(root, file);
    const out: string[] = [];
    const io: CommandIO = { log: (text) => out.push(text), error: (text) => out.push(text) };
    const plan = [
      'element insert nav --into "app/components/TopBar/TopBar.tsx#header" --name links',
      'element insert a --into "app/components/TopBar/TopBar.tsx#nowhere" --text Home',
      // Builds on line 1, which only ran in the copy.
      'element insert a --into "app/components/TopBar/TopBar.tsx#links" --props "href=\'/\'" --text Docs',
      'element insert span --into "TopBar/TopBar.tsx#header" --text Never',
    ].join('\n');
    const code = await runCli({ argv: ['batch', '--dry-run', '--cwd', root, '--json'], commands: COMMANDS, createIO: () => io, readStdin: async () => plan });
    expect(code).toBe(1);
    const result = JSON.parse(out.join('\n'));
    expect(result).toMatchObject({ ok: false, dryRun: true, ran: 4, refused: [2, 4] });
    expect(result.results[2].result.ok).toBe(true);
    expect(result.results[3].result.issues[0].hint).toContain('"app/components/TopBar/TopBar.tsx#header"');
    expect(await read(root, file)).toBe(before);
    expect(await exists(root, `${dir}/TopBar.module.css`)).toBe(true);
  }, 30_000);
});
