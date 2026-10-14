import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/commands/index.js';
import { defineCommand } from '../../src/core/command.js';
import { commandHelp } from '../../src/hosts/cli/help.js';
import type { CommandIO } from '../../src/hosts/cli/io.js';
import { runCli } from '../../src/hosts/cli/main.js';
import { parseCommandArgs, UsageError } from '../../src/hosts/cli/parse.js';
import { createProject, VITE_PROJECT } from '../helpers.js';

const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

function fakeIO() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CommandIO = { log: (text) => out.push(text), error: (text) => err.push(text) };
  return { io, out, err };
}

async function cli(argv: string[]) {
  const { io, out, err } = fakeIO();
  const code = await runCli({ argv, commands: COMMANDS, createIO: () => io });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

const demo = defineCommand({
  name: 'demo',
  description: 'Demo command',
  options: {
    'app-files': { type: 'string', values: ['app', 'root'], description: 'Where' },
    'dry-run': { type: 'boolean', description: 'Preview' },
    name: { type: 'string', placeholder: 'name', description: 'Name' },
  },
  run: async () => ({ ok: true }),
});

describe('parseCommandArgs', () => {
  it('parses global and command options into camelCase', () => {
    expect(parseCommandArgs(demo, ['--app-files', 'root', '--dry-run', '--json', '--cwd', 'x'])).toEqual({
      cwd: 'x',
      json: true,
      help: false,
      options: { appFiles: 'root', dryRun: true, name: undefined },
    });
  });

  it('defaults booleans to false', () => {
    expect(parseCommandArgs(demo, []).options).toEqual({ appFiles: undefined, dryRun: false, name: undefined });
  });

  it.each([
    [['--nope'], 'Unknown option "--nope" for "demo".'],
    [['--app-files', 'src'], '--app-files must be one of "app", "root", got "src".'],
    [['extra'], '"demo" does not take arguments, got "extra".'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCommandArgs(demo, argv)).toThrow(new UsageError(message));
  });
});

describe('commandHelp', () => {
  it('lists the options with their values', () => {
    const help = commandHelp(demo);
    expect(help).toContain('Usage: reactsmith demo [options]');
    expect(help).toMatch(/--app-files <app\|root>\s+Where/);
    expect(help).toMatch(/--name <name>\s+Name/);
    expect(help).toMatch(/-h, --help\s+Show help for the command/);
  });
});

describe('runCli', () => {
  it('prints the general help with the command and its aliases', async () => {
    for (const argv of [['help'], ['-h'], ['--help']]) {
      const result = await cli(argv);
      expect(result.code).toBe(0);
      expect(result.out).toMatch(/init\s+Set up the project/);
      expect(result.out).toMatch(/help\s+Show this help/);
      expect(result.out).toMatch(/version\s+Show the version/);
    }
    expect(await cli([])).toMatchObject({ code: 2, err: expect.stringContaining('Commands:') });
  });

  it('lists the commands as JSON', async () => {
    const { commands } = JSON.parse((await cli(['help', '--json'])).out) as { commands: { name: string }[] };
    expect(commands.map((command) => command.name)).toEqual(['init', 'check', 'help', 'version']);
  });

  it('prints the version with the command and its aliases', async () => {
    expect(await cli(['version'])).toEqual({ code: 0, out: VERSION, err: '' });
    expect(await cli(['-v'])).toEqual({ code: 0, out: VERSION, err: '' });
    expect(await cli(['--version'])).toEqual({ code: 0, out: VERSION, err: '' });
    expect(JSON.parse((await cli(['version', '--json'])).out)).toEqual({ version: VERSION });
  });

  it('always provides help and version, whatever the command set', async () => {
    const { io, out } = fakeIO();
    expect(await runCli({ argv: ['-v'], commands: [], createIO: () => io })).toBe(0);
    expect(await runCli({ argv: ['help'], commands: [demo], createIO: () => io })).toBe(0);
    expect(out[0]).toBe(VERSION);
    expect(out[1]).toMatch(/demo\s+Demo command/);
  });

  it('rejects commands that reuse a name', async () => {
    const { io } = fakeIO();
    const fakeHelp = { ...demo, name: 'help' };
    await expect(runCli({ argv: ['demo'], commands: [fakeHelp], createIO: () => io })).rejects.toThrow('"help"');
    await expect(runCli({ argv: ['demo'], commands: [demo, demo], createIO: () => io })).rejects.toThrow('"demo"');
  });

  it('rejects unknown commands and options of other commands', async () => {
    expect(await cli(['nope'])).toMatchObject({ code: 2, err: expect.stringContaining('Unknown command "nope"') });
    const result = await cli(['check', '--dry-run']);
    expect(result.code).toBe(2);
    expect(result.err).toContain('Unknown option "--dry-run" for "check".');
    expect(result.err).toContain('Usage: reactsmith check');
  });

  it('prints command help', async () => {
    expect(await cli(['init', '--help'])).toMatchObject({ code: 0, out: expect.stringContaining('--app-files <app|root>') });
  });

  it('runs a command with --cwd and --json', async () => {
    const root = await createProject(VITE_PROJECT, { appFiles: 'root', alias: null });
    const result = await cli(['check', '--cwd', root, '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ ok: true, issues: [] });
  });

  it('runs init end to end', async () => {
    const root = await createProject(VITE_PROJECT);
    const result = await cli(['init', '--cwd', root, '--app-files', 'app', '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.out)).toMatchObject({ ok: true, dryRun: false });
  });
});
