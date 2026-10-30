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

  it.each(['reactsmith', 'reactsmith-from-figma'])('%s describes itself for Claude Code, and links only files it ships', async (name) => {
    const text = await shipped('SKILL.md', name);
    expect(text).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`));
    for (const [, link] of text.matchAll(/\]\(([^)]+\.md)\)/g)) expect(await shipped(link!, name)).toBeTruthy();
  });

  it('are all installed by init', async () => {
    const root = await createProject(VITE_PROJECT);
    await runInit(root, { appFiles: 'app' });
    expect(await read(root, '.claude/skills/reactsmith-from-figma/figma-conventions.md')).toBe(await shipped('figma-conventions.md', 'reactsmith-from-figma'));
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

    const edited = block.replace('Write only logic by hand.', 'Write only logic by hand, in hooks.');
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
