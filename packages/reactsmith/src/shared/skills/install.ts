import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { ChangeSet } from '../changes.js';

/** The skills folder of the package. This file sits at the same depth in src/ and dist/. */
const SKILLS_DIR = new URL('../../../skills/', import.meta.url);

/** Where Claude Code finds a project's skills. */
const PROJECT_SKILLS = '.claude/skills';

/** The main skill in a project; the others (e.g. reactsmith-from-figma) sit next to it. */
export const SKILL_DIR = `${PROJECT_SKILLS}/reactsmith`;

/** What the skill's files were when ReactSmith wrote them, to tell its own older versions from changes by hand. */
const MANIFEST = `${SKILL_DIR}/.reactsmith.json`;

/** Line endings don't count: an editor or Git on Windows turning a file to CRLF is not a change by hand. */
const lf = (text: string) => text.replace(/\r\n/g, '\n');
const hash = (text: string) => createHash('sha256').update(lf(text)).digest('hex');

/** The files of every skill the package ships, by path in the skills folder: "reactsmith/SKILL.md". */
async function shippedFiles(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const skills = (await readdir(SKILLS_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const skill of skills) {
    const dir = new URL(`${skill}/`, SKILLS_DIR);
    // Instructions and references (.md), the scripts a skill runs (.mjs), and code it passes to tools (.js).
    for (const name of (await readdir(dir)).filter((file) => /\.(md|mjs|js)$/.test(file)).sort()) files.set(`${skill}/${name}`, await readFile(new URL(name, dir), 'utf8'));
  }
  return files;
}

/** Whether the project has the skill. */
export async function hasSkill(changes: ChangeSet): Promise<boolean> {
  return (await changes.read(`${SKILL_DIR}/SKILL.md`)) !== undefined;
}

/**
 * Plans adding the ReactSmith skills to the project, or bringing it up to date with the installed CLI.
 * A file changed by hand is kept (and reported), so a later version never overwrites it; deleting it brings
 * the new version back. Files a newer version no longer ships go, unless they were changed by hand.
 * CLAUDE.md gets a short block pointing to the skill.
 */
export async function planSkillInstall(changes: ChangeSet): Promise<void> {
  const manifestText = await changes.read(MANIFEST);
  const manifest = manifestText ? (JSON.parse(manifestText) as { files?: Record<string, string>; claudeMd?: string }) : undefined;
  const recorded = manifest?.files ?? {};
  const shipped = await shippedFiles();
  const written: Record<string, string> = {};

  for (const [name, content] of shipped) {
    const fileRel = `${PROJECT_SKILLS}/${name}`;
    const current = await changes.read(fileRel);
    if (current === undefined) {
      changes.write(fileRel, content, { type: 'create', message: 'skill for Claude Code' });
    } else if (lf(current) !== lf(content)) {
      if (recorded[name] !== hash(current)) {
        changes.skip(fileRel, 'changed by hand, kept: delete it to get the version of this ReactSmith');
        if (recorded[name]) written[name] = recorded[name];
        continue;
      }
      changes.write(fileRel, content, { type: 'update', message: 'skill brought up to date' });
    }
    written[name] = hash(content);
  }

  for (const [name, recordedHash] of Object.entries(recorded)) {
    if (shipped.has(name)) continue;
    const fileRel = `${PROJECT_SKILLS}/${name}`;
    const current = await changes.read(fileRel);
    if (current !== undefined && hash(current) === recordedHash) changes.delete(fileRel, 'no longer part of the skill');
  }

  const claudeMd = await planClaudeMdBlock(changes, manifest?.claudeMd);
  const next = `${JSON.stringify({ files: written, ...(claudeMd ? { claudeMd } : {}) }, null, 2)}\n`;
  if (next !== manifestText) changes.writeSilently(changes.resolve(MANIFEST), next);
}

const CLAUDE_MD = 'CLAUDE.md';
const BLOCK_START = '<!-- reactsmith:start -->';
const BLOCK_END = '<!-- reactsmith:end -->';

/**
 * Plans the ReactSmith block of the project's CLAUDE.md: a pointer to the skill, which Claude reads on every task,
 * so it uses the commands even when a small task doesn't load the skill. Only the part between the markers is
 * ReactSmith's: a missing file is created, an existing one gets the block at its end. A block changed by hand is
 * kept, and a block removed by hand is not added again. Returns the hash of the block as it now is, if any.
 */
async function planClaudeMdBlock(changes: ChangeSet, recorded: string | undefined): Promise<string | undefined> {
  const body = (await readFile(new URL('CLAUDE.md', SKILLS_DIR), 'utf8')).trim();
  const block = `${BLOCK_START}\n${body}\n${BLOCK_END}`;
  const text = await changes.read(CLAUDE_MD);
  const start = text?.indexOf(BLOCK_START) ?? -1;
  const end = text?.indexOf(BLOCK_END, start) ?? -1;

  if (text === undefined || start === -1 || end === -1) {
    if (text !== undefined && recorded) {
      changes.skip(CLAUDE_MD, 'the ReactSmith block was removed by hand, not added again');
      return recorded;
    }
    const updated = text === undefined ? `${block}\n` : `${text.replace(/\s*$/, '')}\n\n${block}\n`;
    changes.write(CLAUDE_MD, updated, { type: text === undefined ? 'create' : 'update', message: 'points Claude to the ReactSmith skill' });
    return hash(block);
  }

  const current = text!.slice(start, end + BLOCK_END.length);
  // Already this version's block: record it, so the next version sees it as untouched.
  if (lf(current) === block) return hash(block);
  if (recorded !== hash(current)) {
    changes.skip(CLAUDE_MD, 'the ReactSmith block was changed by hand, kept');
    return recorded;
  }
  // The new block keeps the file's line endings.
  const written = text!.includes('\r\n') ? block.replace(/\n/g, '\r\n') : block;
  changes.write(CLAUDE_MD, `${text!.slice(0, start)}${written}${text!.slice(end + BLOCK_END.length)}`, { type: 'update', message: 'ReactSmith block brought up to date' });
  return hash(block);
}
