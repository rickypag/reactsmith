import { describe, expect, it } from 'vitest';
import { styleRadiusCommand } from '../../src/commands/style/radius/command.js';
import { styleSpacingCommand } from '../../src/commands/style/spacing/command.js';
import { checkStructure } from '../../src/shared/structure/check.js';
import { createProject, read } from '../helpers.js';

const tokens = 'src/app/styles/tokens';
const globalPath = 'src/app/styles/global.css';

type Options = Partial<Record<'set' | 'mode' | 'remove', string>>;
const run = (command: typeof styleSpacingCommand, root: string, options: Options) =>
  command.run({ cwd: root, args: {}, options: { set: options.set, mode: options.mode, remove: options.remove, dryRun: false } });

const codes = (result: { issues?: { code: string }[] }) => result.issues?.map((issue) => issue.code);

describe('style spacing and style radius', () => {
  it('write the default scales, with the variables the layout options use and --radius itself', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    expect((await run(styleSpacingCommand, root, {})).summary).toBe('Spacing written from spacing.json.');
    expect((await run(styleRadiusCommand, root, {})).summary).toBe('Radius written from radius.json.');
    const spacing = await read(root, `${tokens}/spacing.css`);
    for (const [step, value] of [[1, '0.25rem'], [2, '0.5rem'], [6, '1.5rem'], [8, '2rem']]) expect(spacing).toContain(`  --space-${step}: ${value};\n`);
    const radius = await read(root, `${tokens}/radius.css`);
    expect(radius).toContain('  --radius: 0.375rem;\n');
    expect(radius).toContain('  --radius-lg: 0.5rem;\n');
    expect(await read(root, `${tokens}/radius.ts`)).toContain("export const RADIUS_TOKENS = [\n  'default',\n  'sm',");
  });

  it('set tokens with references and mobile values, and refuse values that are not lengths', async () => {
    const root = await createProject({}, { appFiles: 'app' });
    const set = await run(styleSpacingCommand, root, { set: '12=3rem; section={12}' });
    expect(set.summary).toBe('Spacing updated: 12, section.');
    await run(styleSpacingCommand, root, { set: 'section=2rem', mode: 'mobile' });
    const css = await read(root, `${tokens}/spacing.css`);
    expect(css).toContain('  --space-section: var(--space-12);\n');
    expect(css).toContain('@media (max-width: 767px) {\n  :root {\n    --space-section: 2rem;\n  }\n}\n');
    expect(codes(await run(styleSpacingCommand, root, { set: 'huge=lots' }))).toEqual(['space-invalid']);
    expect(codes(await run(styleRadiusCommand, root, { set: 'pill=round' }))).toEqual(['radius-invalid']);
  });

  it('move the variables out of an older global.css, tidying the lines they leave', async () => {
    const old = [
      "@import './tokens/colors.css';",
      '',
      ':root {',
      '  color-scheme: light dark;',
      '',
      '  --space-1: 0.25rem;',
      '  --space-2: 0.6rem;',
      '',
      '  --radius: 0.5rem;',
      '}',
      '',
      'body {',
      '  margin: 0;',
      '}',
      '',
    ].join('\n');
    const root = await createProject({ [globalPath]: old, [`${tokens}/colors.css`]: ':root {}\n' }, { appFiles: 'app' });
    expect((await run(styleSpacingCommand, root, {})).issues).toEqual([]);
    expect((await run(styleRadiusCommand, root, {})).issues).toEqual([]);
    expect(await read(root, globalPath)).toBe("@import './tokens/colors.css';\n@import './tokens/spacing.css';\n@import './tokens/radius.css';\n\n:root {\n  color-scheme: light dark;\n}\n\nbody {\n  margin: 0;\n}\n");
    expect(JSON.parse(await read(root, `${tokens}/spacing.json`))['2']).toBe('0.6rem');
    expect(JSON.parse(await read(root, `${tokens}/radius.json`)).default).toBe('0.5rem');
  });
});

describe('check: spacing and radius', () => {
  it('reports variables the styles use that are not tokens, and variables still in global.css', async () => {
    const component = 'src/app/components/Card/Card.module.css';
    const root = await createProject({ [component]: '.root {\n  padding: var(--space-2) var(--space-10);\n  border-radius: var(--radius);\n}\n' }, { appFiles: 'app' });
    await run(styleSpacingCommand, root, {});
    await run(styleRadiusCommand, root, {});
    const issues = (await checkStructure(root)).issues.filter((issue) => /space|radius/.test(issue.code)).map((issue) => `${issue.code} ${issue.message}`);
    expect(issues).toEqual(['space-unknown --space-10 is not in tokens/spacing.json.']);

    const old = await createProject({ [globalPath]: ':root {\n  --radius: 4px;\n}\n' }, { appFiles: 'app' });
    expect((await checkStructure(old)).issues.filter((issue) => /legacy/.test(issue.code)).map((issue) => issue.code)).toEqual(['radius-legacy']);
  });
});
