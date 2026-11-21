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
      args: {},
      options: { appFiles: 'root', dryRun: true, name: undefined },
    });
  });

  const create = defineCommand({
    name: 'thing create',
    description: 'Create a thing',
    args: [
      { name: 'thing-name', description: 'Name', required: true },
      { name: 'path', description: 'Path' },
    ],
    options: {},
    run: async ({ args }) => ({ ok: true, data: { name: args.thingName, path: args.path } }),
  });

  it('parses positional arguments into camelCase', () => {
    expect(parseCommandArgs(create, ['user-profile', 'settings']).args).toEqual({ thingName: 'user-profile', path: 'settings' });
    expect(parseCommandArgs(create, ['user-profile', '--json']).args).toEqual({ thingName: 'user-profile', path: undefined });
  });

  it.each([
    [[], 'Missing argument <thing-name> for "thing create".'],
    [['a', 'b', 'c'], 'Too many arguments for "thing create", got "c".'],
  ])('rejects arguments %j', (argv, message) => {
    expect(() => parseCommandArgs(create, argv)).toThrow(new UsageError(message));
  });

  it('requires required options, except with --help', () => {
    const withOption = defineCommand({
      name: 'thing move',
      description: '',
      options: { to: { type: 'string', description: 'Target', required: true } },
      run: async () => ({ ok: true }),
    });
    expect(() => parseCommandArgs(withOption, [])).toThrow(new UsageError('Missing option --to for "thing move".'));
    expect(parseCommandArgs(withOption, ['--to', 'x']).options).toEqual({ to: 'x' });
    expect(parseCommandArgs(withOption, ['--help']).help).toBe(true);
    expect(commandHelp(withOption)).toMatch(/--to <value>\s+Target \(required\)/);
  });

  it('does not require arguments with --help', () => {
    expect(parseCommandArgs(create, ['--help']).help).toBe(true);
  });

  it('collects the remaining words in a variadic argument', () => {
    const help = { name: 'help', args: [{ name: 'command', description: '', variadic: true }], options: {} };
    expect(parseCommandArgs(help, ['feature', 'create']).args).toEqual({ command: 'feature create' });
    expect(parseCommandArgs(help, []).args).toEqual({ command: undefined });
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

describe('command groups', () => {
  const groupCommands = [
    defineCommand({
      name: 'thing create',
      description: 'Create a thing',
      args: [{ name: 'name', description: 'The name', required: true }],
      options: {},
      run: async ({ args }) => ({ ok: true, summary: `Created ${args.name}.` }),
    }),
    defineCommand({ name: 'thing remove', description: 'Remove a thing', options: {}, run: async () => ({ ok: true }) }),
  ];

  async function run(argv: string[]) {
    const { io, out, err } = fakeIO();
    const code = await runCli({ argv, commands: groupCommands, createIO: () => io });
    return { code, out: out.join('\n'), err: err.join('\n') };
  }

  it('runs a subcommand with its arguments', async () => {
    expect(await run(['thing', 'create', 'box'])).toMatchObject({ code: 0, out: expect.stringContaining('Created box.') });
  });

  it('shows the group help', async () => {
    const asked = await run(['thing', '--help']);
    expect(asked.code).toBe(0);
    expect(asked.out).toContain('Usage: reactsmith thing <command> [options]');
    expect(asked.out).toMatch(/thing create <name>\s+Create a thing/);
    expect(asked.out).toMatch(/thing remove\s+Remove a thing/);
    expect(await run(['thing'])).toMatchObject({ code: 2, err: expect.stringContaining('thing create <name>') });
  });

  it('rejects unknown subcommands and missing arguments', async () => {
    expect(await run(['thing', 'paint'])).toMatchObject({ code: 2, err: expect.stringContaining('Unknown command "thing paint"') });
    expect(await run(['thing', 'create'])).toMatchObject({ code: 2, err: expect.stringContaining('Missing argument <name>') });
  });

  it('shows the help of a command or group with "help"', async () => {
    expect((await run(['help', 'thing', 'create'])).out).toContain('Usage: reactsmith thing create <name> [options]');
    expect((await run(['help', 'thing', 'create'])).out).toMatch(/Arguments:\s+name\s+The name/);
    expect((await run(['help', 'thing'])).out).toContain('Usage: reactsmith thing <command> [options]');
    expect(await run(['help', 'nope'])).toMatchObject({ code: 2, err: expect.stringContaining('Unknown command "nope"') });
  });
});

describe('runCli', () => {
  it('prints the general help with the command and its aliases', async () => {
    for (const argv of [['help'], ['-h'], ['--help']]) {
      const result = await cli(argv);
      expect(result.code).toBe(0);
      expect(result.out).toMatch(/init\s+Set up the project/);
      expect(result.out).toMatch(/help \[command\.\.\.\]\s+Show the help/);
      expect(result.out).toMatch(/version\s+Show the version/);
    }
    expect(await cli([])).toMatchObject({ code: 2, err: expect.stringContaining('Commands:') });
  });

  it('lists the commands as JSON', async () => {
    const { commands } = JSON.parse((await cli(['help', '--json'])).out) as { commands: { name: string }[] };
    expect(commands.map((command) => command.name)).toEqual(['init', 'check', 'feature create', 'view create', 'layout create', 'component create', 'component update', 'component remove', 'element insert', 'element update', 'element move', 'element remove', 'constant create', 'constant update', 'constant remove', 'style palette', 'style typography', 'style spacing', 'style radius', 'style update', 'style convert', 'messages', 'id', 'tree', 'batch', 'help', 'version']);
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

  it('reports a crash as an internal error, as JSON with --json, and as a bug to report', async () => {
    const crash = defineCommand({
      name: 'crash',
      description: 'Throws',
      options: {},
      run: async () => {
        throw new TypeError('boom');
      },
    });
    const { io, out } = fakeIO();
    expect(await runCli({ argv: ['crash', '--json'], commands: [crash], createIO: () => io })).toBe(1);
    const result = JSON.parse(out.join('\n'));
    expect(result).toMatchObject({ ok: false, issues: [{ severity: 'error', code: 'internal-error' }] });
    expect(result.issues[0].message).toContain(`"crash" crashed (ReactSmith ${VERSION}): boom`);
    expect(result.issues[0].hint).toContain('https://github.com/rickypag/reactsmith/issues');
    expect(result.issues[0].hint).toContain('TypeError: boom');

    const text = fakeIO();
    expect(await runCli({ argv: ['crash'], commands: [crash], createIO: () => text.io })).toBe(1);
    expect(text.out.join('\n')).toContain('(internal-error)');
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

describe('runSafely', () => {
  it('lists no actions for a refused command: nothing was written', async () => {
    const { runSafely } = await import('../../src/hosts/cli/internal-error.js');
    const refused = await runSafely('x', async () => ({ ok: false, actions: [{ type: 'update', path: 'a.ts', message: 'planned' }], issues: [] }));
    expect(refused.actions).toEqual([]);
    const done = await runSafely('x', async () => ({ ok: true, actions: [{ type: 'update', path: 'a.ts', message: 'done' }] }));
    expect(done.actions).toHaveLength(1);
  });
});
