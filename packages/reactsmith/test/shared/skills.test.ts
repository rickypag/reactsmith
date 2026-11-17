import { readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runInit } from '../../src/commands/init/init.js';
import { COMMANDS } from '../../src/commands/index.js';
import { commandReference } from '../../src/hosts/cli/reference.js';
import { createProject, exists, read, VITE_PROJECT } from '../helpers.js';

const skill = '.claude/skills/reactsmith';
const shipped = (name: string, from = 'reactsmith') => readFile(new URL(`../../skills/${from}/${name}`, import.meta.url), 'utf8');
const actions = (result: { actions: { type: string; path: string }[] }) =>
  result.actions.filter((action) => action.path.startsWith(skill)).map((action) => `${action.type} ${action.path}`);

describe('the skills', () => {
  it('ship a command reference that matches the commands (run "npm run build" when this fails)', async () => {
    expect(await shipped('commands.md')).toBe(commandReference(COMMANDS));
  });

  it.each(['reactsmith', 'reactsmith-from-figma', 'reactsmith-resolver'])('%s describes itself for Claude Code, and links only files it ships', async (name) => {
    const text = await shipped('SKILL.md', name);
    expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
    for (const [, link] of text.matchAll(/\]\(([^)]+\.md)\)/g)) expect(await shipped(link!, name)).toBeTruthy();
  });

  it('are all installed by init', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { appFiles: 'app' });
    expect(await read(root, '.claude/skills/reactsmith-from-figma/figma-conventions.md')).toBe(await shipped('figma-conventions.md', 'reactsmith-from-figma'));
    expect(await read(root, '.claude/skills/reactsmith-from-figma/export-node.js')).toBe(await shipped('export-node.js', 'reactsmith-from-figma'));
  });

  it('export a link\'s node in parts small enough for the MCP server, all of one export', async () => {
    const script = await shipped('export-node.js', 'reactsmith-from-figma');
    const block = script.slice(script.indexOf('// <export-parts>'), script.indexOf('// </export-parts>'));
    const exportPart = new Function(`${block}\nreturn exportPart;`)() as (bundle: object, part: number) => Record<string, unknown>;
    const definition = (id: string) => ({ id, name: id, type: 'COMPONENT', description: 'x'.repeat(20000) });
    const bundle = {
      format: 'reactsmith-figma/1', source: 'mcp', fileKey: 'abc', exportedAt: '2026-11-02T10:00:00.000Z',
      roots: ['1:1'], pages: { '1:1': 'Sections' }, nodes: { '1:1': { document: { id: '1:1' } } },
      definitions: { 'a': definition('a'), 'b': definition('b'), 'c': definition('c') },
      variables: { v: { name: 'Text/Default' } },
    };
    const first = exportPart(bundle, 1);
    expect(first).toMatchObject({ part: 1, parts: 3, roots: ['1:1'], definitions: {}, variables: bundle.variables });
    const second = exportPart(bundle, 2);
    const third = exportPart(bundle, 3);
    expect(Object.keys(second.definitions as object)).toEqual(['a', 'b']);
    expect(Object.keys(third.definitions as object)).toEqual(['c']);
    for (const part of [first, second, third]) {
      expect(JSON.stringify(part).length).toBeLessThanOrEqual(45000);
      expect(part.exportedAt).toBe(bundle.exportedAt);
    }
    expect(second.roots).toEqual([]);
    expect(() => exportPart(bundle, 4)).toThrow('this export has 3 parts');
    // Variables that don't fit next to the nodes get a part of their own.
    const heavy = { ...bundle, variables: { v: { name: 'x'.repeat(30000) } }, nodes: { '1:1': { document: { id: '1:1', name: 'y'.repeat(20000) } } } };
    expect(exportPart(heavy, 1)).toMatchObject({ part: 1, parts: 4, variables: {} });
    expect(exportPart(heavy, 2)).toMatchObject({ part: 2, variables: heavy.variables, definitions: {} });
    // A node too large by itself comes as the text of the whole export, in slices that join back into it.
    const huge = { ...bundle, nodes: { '1:1': { document: { id: '1:1', name: '"quoted" '.repeat(12000) } } } };
    const slice = exportPart(huge, 1);
    const count = slice.parts as number;
    expect(count).toBeGreaterThan(2);
    const slices = Array.from({ length: count }, (_, index) => exportPart(huge, index + 1));
    for (const each of slices) expect(JSON.stringify(each).length).toBeLessThanOrEqual(45000);
    expect(JSON.parse(slices.map((each) => each.text).join(''))).toEqual(huge);
    // A small export comes whole, without parts.
    const small = exportPart({ ...bundle, definitions: { a: { id: 'a' } } }, 1);
    expect(small.parts).toBeUndefined();
    expect(Object.keys(small.definitions as object)).toEqual(['a']);
  });

  it('export places in frames without auto layout, exact colors, and the structure alone for the MCP path', async () => {
    const script = await shipped('export-node.js', 'reactsmith-from-figma');
    const core = script.slice(script.indexOf('// <export-core>'), script.indexOf('// </export-core>'));
    const variable = { name: 'Text/Muted', variableCollectionId: 'c', resolvedType: 'COLOR', codeSyntax: { WEB: 'var(--text-muted)' }, valuesByMode: { m: { r: 160 / 255, g: 153 / 255, b: 153 / 255, a: 1 } } };
    const figma = {
      mixed: Symbol('mixed'),
      fileKey: 'abc',
      variables: { getVariableByIdAsync: async () => variable, getVariableCollectionByIdAsync: async () => ({ name: 'Colors', modes: [{ modeId: 'm', name: 'Light' }] }) },
    };
    const frame: Record<string, unknown> = { id: '1:1', name: 'Desktop', type: 'FRAME', visible: true, layoutMode: 'NONE', absoluteBoundingBox: { x: 500, y: 500, width: 1440, height: 900 }, fills: [], strokes: [], effects: [], parent: { type: 'PAGE', name: 'Home' } };
    const label = {
      id: '1:2', name: 'Search', type: 'TEXT', visible: true, x: 299, y: 263, absoluteBoundingBox: { x: 799, y: 763, width: 841, height: 41 },
      layoutSizingHorizontal: 'FIXED', layoutSizingVertical: 'FIXED', characters: 'Search', fontName: { family: 'Inter', style: 'Regular' }, fontSize: 25,
      fills: [{ type: 'SOLID', color: { r: 160 / 255, g: 153 / 255, b: 153 / 255 } }], strokes: [], effects: [], parent: frame,
    };
    const photo = { id: '1:3', name: 'Girl', type: 'RECTANGLE', visible: true, x: 449, y: 337, absoluteBoundingBox: { x: 949, y: 837, width: 30, height: 30 }, fills: [{ type: 'IMAGE' }], strokes: [], effects: [], parent: frame };
    const bound = { ...label, id: '1:4', name: 'Hint', fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, boundVariables: { color: { id: 'v1' } } }] };
    frame.children = [label, photo, bound];
    const exportNodes = new Function('figma', `${core}\nreturn exportNodes;`)(figma) as (roots: object[], source: string, structure?: boolean) => Promise<any>;

    const full = await exportNodes([frame], 'mcp', false);
    const [text] = full.nodes['1:1'].document.children;
    // A child of a frame without auto layout keeps its place, from its parent's corner; the color keeps its value (#a09999).
    expect(text.absoluteBoundingBox).toEqual({ x: 299, y: 263, width: 841, height: 41 });
    expect(Math.round(text.fills[0].color.r * 255)).toBe(160);
    expect(full.nodes['1:1'].document.absoluteBoundingBox).toEqual({ width: 1440, height: 900 });

    const structure = await exportNodes([frame], 'mcp', true);
    expect(structure.structure).toBe(true);
    expect(structure.nodes['1:1'].document.children).toEqual([
      { id: '1:2', name: 'Search', type: 'TEXT', characters: 'Search' },
      { id: '1:3', name: 'Girl', type: 'RECTANGLE', image: true },
      { id: '1:4', name: 'Hint', type: 'TEXT', characters: 'Search' },
    ]);
    // The variables the styles use are still there, in every mode, with the name the design's code uses.
    expect(structure.variables.v1).toMatchObject({ name: 'Text/Muted', codeSyntax: 'var(--text-muted)', values: { Light: { r: 0.627 } } });
  });

  it('export a link\'s node with the same code as the export plugin', async () => {
    const core = (text: string) => text.slice(text.indexOf('// <export-core>'), text.indexOf('// </export-core>'));
    const plugin = await readFile(new URL('../../../figma-export/code.js', import.meta.url), 'utf8');
    const script = await shipped('export-node.js', 'reactsmith-from-figma');
    expect(core(plugin).length).toBeGreaterThan(1000);
    expect(core(script)).toBe(core(plugin));
  });
});

describe('init and the skill', () => {
  it('adds the skill by default, and leaves it out with noSkills', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { appFiles: 'app' });
    expect(await read(root, `${skill}/SKILL.md`)).toBe(await shipped('SKILL.md'));
    expect(await read(root, `${skill}/commands.md`)).toBe(await shipped('commands.md'));

    const without = await createProject(VITE_PROJECT);
    await runInit(without, { appFiles: 'app', noSkills: true });
    expect(await exists(without, skill)).toBe(false);
    expect(await exists(without, 'CLAUDE.md')).toBe(false);
  });

  it('points to the skill in CLAUDE.md: its own block, which it keeps up to date and never forces back', async () => {
    const block = `<!-- reactsmith:start -->\n${(await readFile(new URL('../../skills/CLAUDE.md', import.meta.url), 'utf8')).trim()}\n<!-- reactsmith:end -->`;
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { appFiles: 'app' });
    expect(await read(root, 'CLAUDE.md')).toBe(`${block}\n`);

    // In an existing CLAUDE.md, the block goes at the end; the rest stays the user's.
    const own = await createProject({ ...VITE_PROJECT, 'CLAUDE.md': '# My project\n\nUse pnpm.\n' });
    await runInit(own, { appFiles: 'app' });
    expect(await read(own, 'CLAUDE.md')).toBe(`# My project\n\nUse pnpm.\n\n${block}\n`);

    // An older block is replaced in place; one changed by hand is kept.
    const manifest = path.join(own, skill, '.reactsmith.json');
    const { createHash } = await import('node:crypto');
    const older = '<!-- reactsmith:start -->\nold\n<!-- reactsmith:end -->';
    const data = JSON.parse(await readFile(manifest, 'utf8'));
    await writeFile(path.join(own, 'CLAUDE.md'), `# My project\n\n${older}\n\nMore notes.\n`);
    await writeFile(manifest, JSON.stringify({ ...data, claudeMd: createHash('sha256').update(older).digest('hex') }));
    await runInit(own, { appFiles: 'app' });
    expect(await read(own, 'CLAUDE.md')).toBe(`# My project\n\n${block}\n\nMore notes.\n`);

    // Line endings turned to CRLF (an editor, Git on Windows) are not a change by hand: a newer block still replaces
    // it, in CRLF, and a block already up to date is recorded as such.
    const olderCrlf = '<!-- reactsmith:start -->\r\nolder\r\n<!-- reactsmith:end -->';
    await writeFile(path.join(own, 'CLAUDE.md'), `# My project\r\n\r\n${olderCrlf}\r\n`);
    await writeFile(manifest, JSON.stringify({ ...data, claudeMd: createHash('sha256').update(olderCrlf.replace(/\r\n/g, '\n')).digest('hex') }));
    await runInit(own, { appFiles: 'app' });
    expect(await read(own, 'CLAUDE.md')).toBe(`# My project\r\n\r\n${block.replace(/\n/g, '\r\n')}\r\n`);
    await writeFile(manifest, JSON.stringify({ ...data, claudeMd: 'stale' }));
    await runInit(own, { appFiles: 'app' });
    expect(JSON.parse(await readFile(manifest, 'utf8')).claudeMd).toBe(createHash('sha256').update(block).digest('hex'));

    expect(block).toContain('**Logic is written by hand**');
    const edited = block.replace('**Logic is written by hand**', '**Logic is written by hand, in hooks**');
    await writeFile(path.join(own, 'CLAUDE.md'), `${edited}\n`);
    expect(actions(await runInit(own, { appFiles: 'app' }))).toEqual([]);
    expect(await read(own, 'CLAUDE.md')).toBe(`${edited}\n`);

    // A block removed by hand stays removed.
    await writeFile(path.join(own, 'CLAUDE.md'), '# My project\n');
    await runInit(own, { appFiles: 'app' });
    expect(await read(own, 'CLAUDE.md')).toBe('# My project\n');
  }, 30_000);

  it('asks before adding it, and adds it when a later init is answered yes', async () => {
    const root = await createProject(VITE_PROJECT);
    const questions: string[] = [];
    await runInit(root, { appFiles: 'app', confirm: async (question) => (questions.push(question), false) });
    expect(questions).toEqual([`Add the ReactSmith skill for Claude Code to ${skill}, with a pointer to it in CLAUDE.md?`]);
    expect(await exists(root, skill)).toBe(false);

    await runInit(root, { appFiles: 'app', confirm: async () => true });
    expect(await exists(root, `${skill}/SKILL.md`)).toBe(true);
  });

  it('brings its own files up to date without asking, and keeps the ones changed by hand', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { appFiles: 'app' });
    const manifest = path.join(root, skill, '.reactsmith.json');
    // An older version of ReactSmith wrote other content, recorded in the manifest; a file it shipped is gone now.
    const old = '# old\n';
    const { createHash } = await import('node:crypto');
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const files = JSON.parse(await readFile(manifest, 'utf8')).files as Record<string, string>;
    await writeFile(path.join(root, skill, 'commands.md'), old);
    await writeFile(path.join(root, skill, 'retired.md'), old);
    await writeFile(path.join(root, skill, 'by-hand.md'), '# my own notes\n');
    await writeFile(manifest, JSON.stringify({ files: { ...files, 'reactsmith/commands.md': sha(old), 'reactsmith/retired.md': sha(old) } }));

    const result = await runInit(root, { appFiles: 'app', confirm: async () => false });
    expect(actions(result)).toEqual([`skip ${skill}/by-hand.md`, `update ${skill}/commands.md`, `delete ${skill}/retired.md`]);
    expect(await read(root, `${skill}/commands.md`)).toBe(await shipped('commands.md'));
    expect(await read(root, `${skill}/by-hand.md`)).toBe('# my own notes\n');

    // Deleting a kept file brings the current version back.
    await unlink(path.join(root, skill, 'by-hand.md'));
    expect(actions(await runInit(root, { appFiles: 'app' }))).toEqual([`create ${skill}/by-hand.md`]);
    expect(actions(await runInit(root, { appFiles: 'app' }))).toEqual([]);
  });
});
