#!/usr/bin/env node
import { runCli } from './hosts/cli/main.js';
import { terminalIO } from './hosts/cli/io.js';
import { COMMANDS } from './commands/index.js';

runCli({ argv: process.argv.slice(2), commands: COMMANDS, createIO: terminalIO }).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);
